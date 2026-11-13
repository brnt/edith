import hashlib
from dataclasses import dataclass
from pathlib import Path

import structlog

from edith.core.errors import MediaError, MediaNotFound
from edith.db.documents import EDIT, EDIT_ID, MEDIA, SYNC, SYNC_ID, EditList, MediaItem, SyncState
from edith.db.project_file import ProjectFile
from edith.services import discovery
from edith.services import mediafiles as lib
from edith.services.projects import open_project, project_folder
from edith.services.proxies import proxy_path
from edith.sync import media as probing

log = structlog.get_logger()


@dataclass(frozen=True)
class MediaRecord:
    item: MediaItem
    proxy_ready: bool
    included: bool = True  # False: found in the project folder, not part of the project yet
    missing: bool = False  # the file is no longer where the project says it is
    folder: str = ""  # its directory, within the project folder
    size_bytes: int | None = None


def media_id(rel_path: str) -> str:
    return hashlib.sha1(rel_path.encode()).hexdigest()[:10]


def _kind(rel: str, info: probing.MediaInfo) -> str:
    by_ext = lib.kind_for(rel)
    if by_ext == "image":
        return "image"
    return "video" if info.has_video else "audio"


def build_item(folder: Path, rel_path: str) -> MediaItem:
    """Probe a file of the project folder and describe it as a MediaItem."""
    source = lib.media_file(folder, rel_path)
    rel = str(lib.safe_relative(rel_path))
    info = probing.probe(source)
    return MediaItem(
        id=media_id(rel),
        path=rel,
        kind=_kind(rel, info),
        label=source.name,
        duration_s=info.duration_s,
        width=info.width,
        height=info.height,
        fps=info.fps,
        has_audio=info.has_audio,
    )


def include_media(slug: str, rel_path: str) -> MediaRecord:
    """Make a file of the project folder part of the project (the edit that writes it)."""
    item = build_item(project_folder(slug), rel_path)
    with open_project(slug, writable=True) as project:
        # Joins at the end: what is there keeps its place (and so its channel number).
        existing = project.get(MEDIA, item.id)
        if existing is not None and isinstance(existing.document, MediaItem):
            item.added = existing.document.added  # included again: it stays where it was
        else:
            item.added = _next_added(project)
        project.put(MEDIA, item.id, item)
    log.info("media_included", slug=slug, media=item.id, kind=item.kind)
    return _record(slug, item, included=True)


def _next_added(project: ProjectFile) -> int:
    return 1 + max(
        (
            d.document.added if d.document.added is not None else -1
            for d in project.documents_of(MEDIA)
            if isinstance(d.document, MediaItem)
        ),
        default=-1,
    )


def _record(slug: str, item: MediaItem, *, included: bool) -> MediaRecord:
    folder = project_folder(slug)
    try:
        size = (folder / item.path).stat().st_size
    except OSError:
        size = None
    return MediaRecord(
        item,
        proxy_path(folder, item).is_file(),
        included=included,
        missing=size is None,
        folder=item.path.rpartition("/")[0],
        size_bytes=size,
    )


def _referenced(project: ProjectFile) -> set[str]:
    """Media ids the edit still names (a missing file nothing names has nothing left to show)."""
    ids: set[str] = set()
    if (edit := project.get(EDIT, EDIT_ID)) and isinstance(edit.document, EditList):
        doc = edit.document
        ids |= {s.media_id for s in doc.switches if s.media_id}
        ids |= {t.media_id for t in doc.tracks}
        ids |= {m.media_id for m in doc.mix}
        ids |= set(doc.disabled)
    if (sync := project.get(SYNC, SYNC_ID)) and isinstance(sync.document, SyncState):
        if sync.document.template and sync.document.template.media_id:
            ids.add(sync.document.template.media_id)
    return ids


_KIND_ORDER = {"video": 0, "audio": 1, "image": 2}


def _order(item: MediaItem) -> tuple[int, int, str]:
    """The project's order: as added; older projects (nothing recorded) first, cameras then audio
    then stills, by name."""
    if item.added is not None:
        return (1, item.added, "")
    return (0, _KIND_ORDER[item.kind], item.label.lower())


def list_media(slug: str, *, with_available: bool = False) -> list[MediaRecord]:
    """The project's media; with `with_available`, also the files lying in its folder unused.

    A file that has gone missing and that nothing in the edit uses is left out (it comes back by
    itself if the file does), so there is nothing to dismiss.
    """
    folder = project_folder(slug)
    with open_project(slug) as project:
        items = [
            d.document for d in project.documents_of(MEDIA) if isinstance(d.document, MediaItem)
        ]
        referenced = _referenced(project)
    items.sort(key=_order)
    records = [_record(slug, i, included=True) for i in items]
    records = [r for r in records if not r.missing or r.item.id in referenced]
    if with_available:
        # In the project already: by path (an item keeps its id when its file moves in the folder or
        # the project file moves, so the id no longer says which file it is) or by id.
        have_ids = {i.id for i in items}
        have_paths = {i.path for i in items}
        for found in discovery.scan(folder):
            if found.rel in have_paths or media_id(found.rel) in have_ids or not found.settled:
                continue  # in the project already, or maybe still copying
            item = discovery.probe_cached(folder, found, build_item)
            if item is not None:
                records.append(_record(slug, item, included=False))
    return records


def resolve_item(slug: str, media_id_: str) -> MediaItem:
    """A project's media item, or a found-but-not-included one (for its thumbnail and details)."""
    folder = project_folder(slug)
    with open_project(slug) as project:
        loaded = project.get(MEDIA, media_id_)
    if loaded is not None:
        assert isinstance(loaded.document, MediaItem)
        return loaded.document
    for found in discovery.scan(folder):
        if media_id(found.rel) == media_id_:
            item = discovery.probe_cached(folder, found, build_item)
            if item is not None:
                return item
    raise MediaNotFound(media_id_)


def get_item(project: ProjectFile, media_id_: str) -> MediaItem:
    loaded = project.get(MEDIA, media_id_)
    if loaded is None:
        raise MediaNotFound(media_id_)
    assert isinstance(loaded.document, MediaItem)
    return loaded.document


def _rename_references(project: ProjectFile, old: str, new: str) -> None:
    """Point everything in the edit and the sync results that names `old` at `new`."""
    if (edit := project.get(EDIT, EDIT_ID)) and isinstance(edit.document, EditList):
        doc = edit.document
        for s in doc.switches:
            if s.media_id == old:
                s.media_id = new
        for t in doc.tracks:
            if t.media_id == old:
                t.media_id = new
        for m in doc.mix:
            if m.media_id == old:
                m.media_id = new
        doc.disabled = [new if d == old else d for d in doc.disabled]
        project.put(EDIT, EDIT_ID, doc)
    if (sync := project.get(SYNC, SYNC_ID)) and isinstance(sync.document, SyncState):
        state = sync.document
        if old in state.results:
            state.results[new] = state.results.pop(old)
        if old in state.nudges:
            state.nudges[new] = state.nudges.pop(old)
        if state.template and state.template.media_id == old:
            state.template.media_id = new
        project.put(SYNC, SYNC_ID, state)


def relink_media(slug: str, media_id_: str, new_rel_path: str) -> MediaRecord:
    """Point a project media item at a different file (it moved, or came back from another drive).

    Media ids come from paths, so the item gets a new id and every reference to the old one in the
    edit and the sync results follows it. The new file must be the same kind of media.
    """
    with open_project(slug) as project:
        old = get_item(project, media_id_)
    new = build_item(project_folder(slug), new_rel_path)
    if new.kind != old.kind:
        raise MediaError(f"{new.label} is {new.kind} media, but {old.label} is {old.kind}")
    if new.id == old.id:
        return _record(slug, old, included=True)
    with open_project(slug, writable=True) as project:
        if project.get(MEDIA, new.id) is not None:
            raise MediaError(f"{new.label} is already in this project")
        new.added = old.added  # it keeps its place
        project.put(MEDIA, new.id, new)
        _rename_references(project, old.id, new.id)
        project.delete(MEDIA, old.id)
    log.info("media_relinked", slug=slug, old=old.id, new=new.id)
    return _record(slug, new, included=True)

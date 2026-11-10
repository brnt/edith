import hashlib
from dataclasses import dataclass
from pathlib import Path

import structlog

from edith.core.errors import MediaNotFound
from edith.db.documents import EDIT, EDIT_ID, MEDIA, SYNC, SYNC_ID, EditList, MediaItem, SyncState
from edith.db.project_file import ProjectFile
from edith.services import discovery
from edith.services import library as lib
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
    folder: str = ""  # its directory, within the project folder (or its own path if outside)
    external: bool = False  # not inside the project folder
    size_bytes: int | None = None


def media_id(rel_path: str) -> str:
    return hashlib.sha1(rel_path.encode()).hexdigest()[:10]


def _kind(rel: str, info: probing.MediaInfo) -> str:
    by_ext = lib.kind_for(rel)
    if by_ext == "image":
        return "image"
    return "video" if info.has_video else "audio"


def build_item(library: Path, rel_path: str) -> MediaItem:
    """Probe a file and describe it as a MediaItem (not yet part of any project)."""
    source = lib.media_file(library, rel_path)
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


def add_media(library: Path, slug: str, rel_path: str) -> MediaRecord:
    item = build_item(library, rel_path)
    with open_project(library, slug, writable=True) as project:
        project.put(MEDIA, item.id, item)
    log.info("media_added", slug=slug, media=item.id, kind=item.kind)
    return _record(library, slug, item, included=True)


def _record(library: Path, slug: str, item: MediaItem, *, included: bool) -> MediaRecord:
    folder = project_folder(library, slug)
    prefix = folder.relative_to(library).as_posix()
    parent = item.path.rpartition("/")[0]
    inside = item.path.startswith(prefix + "/")
    path = library / item.path
    try:
        size = path.stat().st_size
    except OSError:
        size = None
    return MediaRecord(
        item,
        proxy_path(folder, item).is_file(),
        included=included,
        missing=size is None,
        folder=parent[len(prefix) + 1 :] if inside else parent,
        external=not inside,
        size_bytes=size,
    )


def list_media(library: Path, slug: str, *, with_available: bool = False) -> list[MediaRecord]:
    """The project's media; with `with_available`, also the files lying in its folder unused."""
    with open_project(library, slug) as project:
        items = [loaded.document for loaded in project.documents_of(MEDIA)]
    records = [_record(library, slug, i, included=True) for i in items if isinstance(i, MediaItem)]
    if with_available:
        have = {r.item.id for r in records}
        for found in discovery.scan(library, slug):
            if media_id(found.rel) in have or not found.settled:
                continue  # in the project already, or maybe still copying
            item = discovery.probe_cached(library, slug, found, build_item)
            if item is not None:
                records.append(_record(library, slug, item, included=False))
    return records


def resolve_item(library: Path, slug: str, media_id_: str) -> MediaItem:
    """A project's media item, or a found-but-not-included one (for its thumbnail and details)."""
    with open_project(library, slug) as project:
        loaded = project.get(MEDIA, media_id_)
    if loaded is not None:
        assert isinstance(loaded.document, MediaItem)
        return loaded.document
    for found in discovery.scan(library, slug):
        if media_id(found.rel) == media_id_:
            item = discovery.probe_cached(library, slug, found, build_item)
            if item is not None:
                return item
    raise MediaNotFound(media_id_)


def get_item(project: ProjectFile, media_id_: str) -> MediaItem:
    loaded = project.get(MEDIA, media_id_)
    if loaded is None:
        raise MediaNotFound(media_id_)
    assert isinstance(loaded.document, MediaItem)
    return loaded.document


def remove_media(library: Path, slug: str, media_id_: str) -> None:
    """Forget a media item and every reference to it in the edit and sync documents."""
    with open_project(library, slug, writable=True) as project:
        get_item(project, media_id_)
        project.delete(MEDIA, media_id_)
        if (edit := project.get(EDIT, EDIT_ID)) and isinstance(edit.document, EditList):
            doc = edit.document
            doc.switches = [s for s in doc.switches if s.media_id != media_id_]
            doc.tracks = [t for t in doc.tracks if t.media_id != media_id_]
            doc.mix = [m for m in doc.mix if m.media_id != media_id_]
            doc.disabled = [d for d in doc.disabled if d != media_id_]
            project.put(EDIT, EDIT_ID, doc)
        if (sync := project.get(SYNC, SYNC_ID)) and isinstance(sync.document, SyncState):
            state = sync.document
            state.results.pop(media_id_, None)
            state.nudges.pop(media_id_, None)
            if state.template and state.template.media_id == media_id_:
                state.template = None
            project.put(SYNC, SYNC_ID, state)
    log.info("media_removed", slug=slug, media=media_id_)

import hashlib
from dataclasses import dataclass
from pathlib import Path

import structlog

from edith.core.errors import MediaNotFound
from edith.db.documents import EDIT, EDIT_ID, MEDIA, SYNC, SYNC_ID, EditList, MediaItem, SyncState
from edith.db.project_file import ProjectFile
from edith.services import library as lib
from edith.services.projects import open_project, project_folder
from edith.services.proxies import proxy_path
from edith.sync import media as probing

log = structlog.get_logger()


@dataclass(frozen=True)
class MediaRecord:
    item: MediaItem
    proxy_ready: bool


def media_id(rel_path: str) -> str:
    return hashlib.sha1(rel_path.encode()).hexdigest()[:10]


def _kind(rel: str, info: probing.MediaInfo) -> str:
    by_ext = lib.kind_for(rel)
    if by_ext == "image":
        return "image"
    return "video" if info.has_video else "audio"


def add_media(library: Path, slug: str, rel_path: str) -> MediaRecord:
    source = lib.media_file(library, rel_path)
    rel = str(lib.safe_relative(rel_path))
    info = probing.probe(source)
    item = MediaItem(
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
    with open_project(library, slug, writable=True) as project:
        project.put(MEDIA, item.id, item)
    log.info("media_added", slug=slug, media=item.id, kind=item.kind)
    return MediaRecord(item, proxy_ready=proxy_path(project_folder(library, slug), item).is_file())


def list_media(library: Path, slug: str) -> list[MediaRecord]:
    folder = project_folder(library, slug)
    with open_project(library, slug) as project:
        items = [loaded.document for loaded in project.documents_of(MEDIA)]
    return [
        MediaRecord(i, proxy_path(folder, i).is_file()) for i in items if isinstance(i, MediaItem)
    ]


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
            project.put(EDIT, EDIT_ID, doc)
        if (sync := project.get(SYNC, SYNC_ID)) and isinstance(sync.document, SyncState):
            state = sync.document
            state.results.pop(media_id_, None)
            state.nudges.pop(media_id_, None)
            if state.template and state.template.media_id == media_id_:
                state.template = None
            project.put(SYNC, SYNC_ID, state)
    log.info("media_removed", slug=slug, media=media_id_)

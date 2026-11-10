"""Bringing projects from the old library layout into the folder layout (run at startup).

Before: projects lived in `<library>/<name>/` and named their media by path relative to the
*library*, wherever in it the files were (`media/cam.mp4`), with the cache in a visible `cache/`.
Now: a project is a self-contained folder anywhere; media are named relative to it, the cache is the
hidden `.edith/`, and Edith remembers projects in a recent list instead of a library.

Converting a project keeps everything working without moving or copying footage (which several
projects may share): media inside the folder just lose the folder's prefix, and a folder elsewhere
in the library is *linked* into the project folder with a relative link, under the same name, so
the paths stay as they were. Media ids are not touched. A backup of the project file is kept.
"""

import os
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import structlog

from edith.db.documents import (
    MEDIA,
    PROJECT_INFO,
    PROJECT_INFO_ID,
    SYNC,
    SYNC_ID,
    MediaItem,
    ProjectInfo,
    SyncState,
)
from edith.db.project_file import LAYOUT_FOLDER, ProjectFile
from edith.services import recents
from edith.services.projects import project_file_in

log = structlog.get_logger()

BACKUP_SUFFIX = ".before-folder-layout"


@dataclass(frozen=True)
class Converted:
    folder: str
    media: int
    links: list[str]


def _is_legacy(project_file: Path) -> bool:
    with ProjectFile.open(project_file) as project:
        return project.layout() != LAYOUT_FOLDER


class _Placer:
    """Where a legacy (library-relative) media path lives, relative to the project folder."""

    def __init__(self, library: Path, folder: Path, rel: str) -> None:
        self.library, self.folder = library, folder
        self.prefix = PurePosixPath(rel).parts
        self.links: list[str] = []

    def place(self, old: str) -> str:
        path = PurePosixPath(old)
        if path.parts[: len(self.prefix)] == self.prefix and len(path.parts) > len(self.prefix):
            return PurePosixPath(*path.parts[len(self.prefix) :]).as_posix()  # already inside
        top, rest = path.parts[0], path.parts[1:]
        name = self._link(top)
        return PurePosixPath(name, *rest).as_posix()

    def _link(self, top: str) -> str:
        target = self.library / top
        for name in (top, f"linked-{top}"):
            link = self.folder / name
            if link.is_symlink():
                if link.resolve() == target.resolve():
                    return name  # linked by an earlier path of this project (or a hand-made link)
                continue
            if link.exists():
                continue  # a real file or folder with that name: use the other name
            link.symlink_to(os.path.relpath(target, self.folder))
            self.links.append(name)
            return name
        raise OSError(f"no free name to link {top!r} under in {self.folder}")


def convert_project(library: Path, rel: str) -> Converted:
    folder = library / rel
    project_file = project_file_in(folder)
    if project_file is None:
        raise FileNotFoundError(f"no project file in {folder}")
    backup = folder / f"{project_file.name}{BACKUP_SUFFIX}"
    if not backup.exists():
        shutil.copy2(project_file, backup)
    placer = _Placer(library, folder, rel)
    count = 0
    with ProjectFile.open(project_file, writable=True) as project:
        for loaded in project.documents_of(MEDIA):
            item = loaded.document
            if not isinstance(item, MediaItem):
                continue
            item.path = placer.place(item.path)
            project.put(MEDIA, loaded.doc_id, item)
            count += 1
        sync = project.get(SYNC, SYNC_ID)
        if sync and isinstance(sync.document, SyncState):
            state = sync.document
            if state.template and state.template.kind == "file" and state.template.path:
                state.template.path = placer.place(state.template.path)
                project.put(SYNC, SYNC_ID, state)
        project.set_layout(LAYOUT_FOLDER)
    cache, hidden = folder / "cache", folder / ".edith"
    if cache.is_dir() and not hidden.exists():
        cache.rename(hidden)  # proxies and thumbnails already built keep working
    log.info("project_converted", folder=rel, media=count, links=placer.links)
    return Converted(rel, count, placer.links)


def _name_of(project_file: Path) -> str:
    with ProjectFile.open(project_file) as project:
        loaded = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    info = loaded.document if loaded else None
    return info.name if isinstance(info, ProjectInfo) else project_file.parent.name


def import_legacy_library(library: Path, state_dir: Path) -> list[Converted]:
    """Convert every project of an old library to the folder layout and add it to the recent list.

    The old layout was exactly `<library>/<project>/project.edith`, so only that level is looked
    at (nothing is scanned). Safe to repeat: converted projects are skipped, and ones already on the
    recent list are not moved.
    """
    converted: list[Converted] = []
    if not library.is_dir():
        return converted
    for folder in sorted(library.iterdir()):
        project_file = project_file_in(folder) if folder.is_dir() else None
        if folder.name.startswith(".") or project_file is None:
            continue
        try:
            if _is_legacy(project_file):
                converted.append(convert_project(library, folder.name))
            recents.add_if_missing(state_dir, project_file.resolve(), _name_of(project_file))
        except Exception:  # one project failing must not stop the others, or the server
            log.exception("project_conversion_failed", folder=folder.name)
    return converted

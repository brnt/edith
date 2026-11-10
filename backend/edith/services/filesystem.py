"""Browsing folders, so a project's folder can be chosen when it is created or opened.

Edith is a local, single-user app and projects can be anywhere on disk, so this lists any folder
the server can read (folders only; hidden ones skipped). Keep the API on localhost.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from edith.core.errors import InvalidMediaPath
from edith.services.projects import edith_files


@dataclass(frozen=True)
class FolderEntry:
    name: str
    path: str  # absolute
    edith_files: int  # how many projects (.edith files) it holds

    @property
    def is_project(self) -> bool:
        return self.edith_files > 0


@dataclass(frozen=True)
class FileEntry:
    name: str
    path: str  # absolute


@dataclass(frozen=True)
class FolderListing:
    dir: str  # absolute
    parent: str | None
    entries: list[FolderEntry]
    files: list[FileEntry]  # the .edith project files in the listed folder

    @property
    def is_project(self) -> bool:
        return bool(self.files)


@dataclass(frozen=True)
class Place:
    name: str
    path: str


def places() -> list[Place]:
    """Where to start looking: the home folder, and any drives mounted for external storage."""
    found = [Place("Home", str(Path.home()))]
    for mounts in (Path("/Volumes"), Path("/media"), Path("/mnt")):
        if mounts.is_dir():
            found += [
                Place(c.name, str(c))
                for c in sorted(mounts.iterdir())
                if c.is_dir() and not c.name.startswith((".", "com.apple."))  # system volumes
            ]
    return found


def list_folders(directory: str = "") -> FolderListing:
    """The folders and project files in `directory` (absolute; empty = the home folder)."""
    folder = Path(directory).expanduser() if directory else Path.home()
    if not folder.is_absolute() or "\0" in str(folder):
        raise InvalidMediaPath(directory)
    if not folder.is_dir():
        raise InvalidMediaPath(directory)
    entries: list[FolderEntry] = []
    try:
        children = sorted(os.scandir(folder), key=lambda e: e.name.lower())
    except OSError:
        raise InvalidMediaPath(directory) from None
    for child in children:
        if child.name.startswith(".") or not child.is_dir(follow_symlinks=True):
            continue
        path = Path(child.path)
        entries.append(FolderEntry(child.name, str(path), len(edith_files(path))))
    parent = None if folder.parent == folder else str(folder.parent)
    files = [FileEntry(f.name, str(f)) for f in edith_files(folder)]
    return FolderListing(str(folder), parent, entries, files)

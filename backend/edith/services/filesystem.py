"""Browsing folders, so a project's folder can be chosen when it is created or opened.

Edith is a local, single-user app and projects can be anywhere on disk, so this lists any folder
the server can read (folders only; hidden ones skipped). Keep the API on localhost.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from edith.core.errors import FolderExists, InvalidFolderName, InvalidMediaPath
from edith.services.mediafiles import kind_for
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
class MediaFileEntry:
    name: str
    kind: str  # video | audio | image


# How many media files a listing names: enough to recognise a folder by, not a whole card dump.
MAX_MEDIA_LISTED = 300


@dataclass(frozen=True)
class FolderListing:
    dir: str  # absolute
    parent: str | None
    entries: list[FolderEntry]
    files: list[FileEntry]  # the .edith project files in the listed folder
    media: list[MediaFileEntry]  # the files in it of a type Edith can use (the first few hundred)
    media_more: int  # how many more there are than listed

    @property
    def is_project(self) -> bool:
        return bool(self.files)


@dataclass(frozen=True)
class Place:
    name: str
    path: str
    kind: str  # "home" | "drive": what the picker's sidebar draws it as


def _is_system_volume(volume: Path) -> bool:
    """Volumes that are not somewhere to keep a project: macOS's own, Time Machine backups, and
    anything this user can't list."""
    return volume.name.startswith((".", "com.apple.", "Backups of ")) or not os.access(
        volume, os.R_OK | os.X_OK
    )


def places() -> list[Place]:
    """The picker's sidebar: the home folder, then any drives mounted for external storage."""
    found = [Place("Home", str(Path.home()), "home")]
    for mounts in (Path("/Volumes"), Path("/media"), Path("/mnt")):
        if mounts.is_dir():
            found += [
                Place(c.name, str(c), "drive")
                for c in sorted(mounts.iterdir())
                if c.is_dir() and not _is_system_volume(c)
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
    media: list[MediaFileEntry] = []
    try:
        children = sorted(os.scandir(folder), key=lambda e: e.name.lower())
    except OSError:
        raise InvalidMediaPath(directory) from None
    for child in children:
        if child.name.startswith("."):  # hidden, and macOS's ._ shadow files
            continue
        if not child.is_dir(follow_symlinks=True):
            kind = kind_for(child.name)
            if kind and child.is_file(follow_symlinks=True):
                media.append(MediaFileEntry(child.name, kind))
            continue
        path = Path(child.path)
        entries.append(FolderEntry(child.name, str(path), len(edith_files(path))))
    parent = None if folder.parent == folder else str(folder.parent)
    files = [FileEntry(f.name, str(f)) for f in edith_files(folder)]
    shown = media[:MAX_MEDIA_LISTED]
    return FolderListing(str(folder), parent, entries, files, shown, len(media) - len(shown))


def make_folder(parent: str, name: str) -> FolderListing:
    """Make a folder called `name` in `parent`, and list `parent` (the new folder is in it)."""
    folder = Path(parent).expanduser()
    if not folder.is_absolute() or not folder.is_dir():
        raise InvalidMediaPath(parent)
    clean = name.strip()
    if not clean or "/" in clean or "\0" in clean or clean.startswith("."):
        raise InvalidFolderName(
            "Give the folder a name without slashes, and not starting with a dot "
            "(a folder like that would be hidden)."
        )
    target = folder / clean
    if target.exists():
        raise FolderExists(f"“{clean}” already exists in “{folder.name or folder}”.")
    try:
        target.mkdir()
    except OSError as e:
        raise InvalidMediaPath(f"Can't make “{clean}” in {folder}: {e.strerror or e}") from None
    return list_folders(str(folder))

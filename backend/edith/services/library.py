"""Browsing the media library: the folder tree that holds projects and their media."""

from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from edith.core.errors import InvalidMediaPath, MediaNotFound

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".mxf"}
AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".aif", ".aiff", ".ogg"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def kind_for(name: str) -> str | None:
    ext = Path(name).suffix.lower()
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in IMAGE_EXTS:
        return "image"
    return None


def safe_relative(rel: str) -> PurePosixPath:
    """A library-relative path with no way out of the library."""
    path = PurePosixPath(rel)
    if path.is_absolute() or ".." in path.parts or "\0" in rel:
        raise InvalidMediaPath(rel)
    return path


@dataclass(frozen=True)
class LibraryEntry:
    name: str
    path: str
    is_dir: bool
    kind: str | None
    size: int | None


@dataclass(frozen=True)
class LibraryListing:
    dir: str
    parent: str | None
    entries: list[LibraryEntry]


def list_dir(library: Path, rel_dir: str = "") -> LibraryListing:
    rel = safe_relative(rel_dir)
    folder = library / rel
    if not folder.is_dir():
        raise InvalidMediaPath(rel_dir)
    entries: list[LibraryEntry] = []
    for child in sorted(folder.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
        if child.name.startswith("."):
            continue
        child_rel = str(rel / child.name) if str(rel) != "." else child.name
        if child.is_dir():
            entries.append(LibraryEntry(child.name, child_rel, True, None, None))
        elif (kind := kind_for(child.name)) is not None:
            entries.append(LibraryEntry(child.name, child_rel, False, kind, child.stat().st_size))
    parent = None if str(rel) == "." else ("" if len(rel.parts) == 1 else str(rel.parent))
    return LibraryListing(dir="" if str(rel) == "." else str(rel), parent=parent, entries=entries)


def media_file(library: Path, rel: str) -> Path:
    path = library / safe_relative(rel)
    if not path.is_file():
        raise MediaNotFound(f"Can't read {rel}")
    if kind_for(path.name) is None:
        raise InvalidMediaPath(rel)
    return path

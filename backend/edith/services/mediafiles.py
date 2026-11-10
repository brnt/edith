"""Which files are media, and how a project names them (relative to its folder)."""

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
    """A path relative to a project folder, with no way out of it."""
    path = PurePosixPath(rel)
    if path.is_absolute() or ".." in path.parts or "\0" in rel:
        raise InvalidMediaPath(rel)
    return path


def media_file(folder: Path, rel: str) -> Path:
    """A media file of a project, named relative to the project's folder."""
    path = folder / safe_relative(rel)
    if not path.is_file():
        raise MediaNotFound(f"Can't read {rel}")
    if kind_for(path.name) is None:
        raise InvalidMediaPath(rel)
    return path

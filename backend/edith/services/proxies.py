"""Low-resolution stand-ins the browser can scrub quickly. Derived, rebuildable, never the media."""

import os
import subprocess
from pathlib import Path

from edith.core.errors import MediaError
from edith.db.documents import MediaItem

PROXY_HEIGHT = 540
_EXT = {"video": ".mp4", "audio": ".m4a", "image": ".jpg"}
_MIME = {".mp4": "video/mp4", ".m4a": "audio/mp4", ".jpg": "image/jpeg"}


def cache_dir(project_folder: Path) -> Path:
    return project_folder / "cache"


def proxy_path(project_folder: Path, item: MediaItem) -> Path:
    return cache_dir(project_folder) / "proxy" / f"{item.id}{_EXT[item.kind]}"


def proxy_mime(path: Path) -> str:
    return _MIME[path.suffix]


def _command(src: Path, dst: Path, kind: str) -> list[str]:
    base = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src)]
    if kind == "video":
        return [
            *base, "-vf", f"scale=-2:{PROXY_HEIGHT}", "-c:v", "libx264", "-preset", "veryfast",
            "-crf", "28", "-pix_fmt", "yuv420p", "-g", "30",
            "-c:a", "aac", "-ac", "1", "-b:a", "64k", "-movflags", "+faststart", str(dst),
        ]  # fmt: skip
    if kind == "audio":
        return [*base, "-vn", "-c:a", "aac", "-ac", "1", "-b:a", "96k", str(dst)]
    return [*base, "-vf", "scale=1280:-2", "-frames:v", "1", "-q:v", "4", str(dst)]


def build_proxy(src: Path, item: MediaItem, project_folder: Path) -> Path:
    """Encode to a temp file, then rename, so a half-written proxy is never served."""
    dst = proxy_path(project_folder, item)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f"{dst.stem}.partial{dst.suffix}")
    result = subprocess.run(_command(src, tmp, item.kind), capture_output=True)
    if result.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise MediaError(f"proxy failed for {item.label}: {result.stderr.decode().strip()}")
    os.replace(tmp, dst)
    return dst

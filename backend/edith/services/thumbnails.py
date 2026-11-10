"""Tiny preview pictures for the media list. Derived from the original, cached, rebuildable."""

import os
import subprocess
from pathlib import Path

from edith.core.errors import MediaError
from edith.db.documents import MediaItem
from edith.services.proxies import cache_dir

THUMB_HEIGHT = 72  # shown at about 36 px; 2x for sharp screens


def thumb_path(project_folder: Path, item: MediaItem) -> Path:
    return cache_dir(project_folder) / "thumbs" / f"{item.id}.jpg"


def build_thumbnail(source: Path, item: MediaItem, project_folder: Path) -> Path | None:
    """A small JPEG for a video (a frame a tenth of the way in) or an image; None for audio."""
    if item.kind == "audio":
        return None
    dst = thumb_path(project_folder, item)
    if dst.is_file():
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    seek = ["-ss", f"{(item.duration_s or 0) * 0.1:.3f}"] if item.kind == "video" else []
    tmp = dst.with_name(f"{dst.stem}.partial.jpg")
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", *seek, "-i", str(source), "-frames:v", "1",
         "-vf", f"scale=-2:{THUMB_HEIGHT}", "-q:v", "5", str(tmp)],
        capture_output=True,
    )  # fmt: skip
    if result.returncode != 0 or not tmp.is_file():
        tmp.unlink(missing_ok=True)
        raise MediaError(f"thumbnail failed for {item.label}: {result.stderr.decode().strip()}")
    os.replace(tmp, dst)
    return dst

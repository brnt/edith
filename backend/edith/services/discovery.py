"""Finding media files that sit in a project's folder but are not part of the project yet.

Discovery is read-only: it never touches the project file. A found file is *available* (listed,
with a thumbnail and details) until the user includes it, and including it is the edit that writes
it into the project. Probing results are cached under the project's cache folder.
"""

import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

import structlog

from edith.core.errors import MediaError
from edith.db.documents import MediaItem
from edith.services import library as lib
from edith.services.projects import project_folder
from edith.services.proxies import cache_dir

log = structlog.get_logger()

# Top-level folders of a project that hold derived files, never source media.
_SKIPPED_TOP_LEVEL = {"cache", "renders"}
_TEMP_SUFFIXES = {".part", ".partial", ".crdownload", ".tmp", ".download"}
SETTLE_S = 2.0  # a file touched more recently than this may still be copying


@dataclass(frozen=True)
class Found:
    rel: str  # relative to the library root, with forward slashes
    size: int
    mtime_ns: int
    settled: bool


def scan(library: Path, slug: str) -> list[Found]:
    """Every supported media file under the project folder (following links), skipping dotfiles."""
    root = project_folder(library, slug)
    found: list[Found] = []
    seen: set[Path] = set()
    now = time.time()
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        here = Path(dirpath)
        real = here.resolve()
        if real in seen:  # a link loop
            dirnames[:] = []
            continue
        seen.add(real)
        top = here == root
        dirnames[:] = sorted(
            d for d in dirnames if not d.startswith(".") and not (top and d in _SKIPPED_TOP_LEVEL)
        )
        for name in sorted(filenames):
            if name.startswith(".") or Path(name).suffix.lower() in _TEMP_SUFFIXES:
                continue
            if lib.kind_for(name) is None:
                continue
            try:
                stat = (here / name).stat()
            except OSError:  # a broken link, or a file that vanished mid-scan
                continue
            rel = (here / name).relative_to(library).as_posix()
            found.append(
                Found(rel, stat.st_size, stat.st_mtime_ns, now - stat.st_mtime >= SETTLE_S)
            )
    return found


def probe_cached(library: Path, slug: str, f: Found, build) -> MediaItem | None:
    """The MediaItem for a found file, probed once per (path, size, mtime) and remembered.

    `build(library, rel)` does the actual probing; a file that can't be read is remembered as
    unreadable too, so a broken file is not probed again on every poll.
    """
    cache = cache_dir(project_folder(library, slug)) / "probe"
    digest = hashlib.sha1(f.rel.encode()).hexdigest()[:10]
    key = f"{digest}-{f.size}-{f.mtime_ns}.json"
    path = cache / key
    if path.is_file():
        data = json.loads(path.read_text())
        return MediaItem(**data) if "error" not in data else None
    try:
        item = build(library, f.rel)
    except MediaError as e:
        log.warning("discovery_unreadable", path=f.rel, error=str(e))
        cache.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"error": str(e)}))
        return None
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(item.model_dump_json())
    return item

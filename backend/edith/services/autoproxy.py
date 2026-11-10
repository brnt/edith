"""Making proxies without being asked: as soon as media is detected, its preview is prepared.

The media list (polled by the app) notices files that have no proxy and starts one background
builder per media folder, which works through them one at a time, the project's own media first.
A file that can't be encoded is skipped for the rest of the session instead of retried forever.
"""

import threading
from collections.abc import Callable

import structlog

from edith.services import media_items, proxies
from edith.services import mediafiles as lib
from edith.services.projects import project_folder

log = structlog.get_logger()

_lock = threading.Lock()
_working: set[str] = set()  # media folders that have a builder running
_failed: set[tuple[str, str]] = set()  # (media folder, media id) that could not be encoded


def _spawn(work: Callable[[], None]) -> None:
    threading.Thread(target=work, name="autoproxy", daemon=True).start()


def needed(folder: str, records: list[media_items.MediaRecord]) -> list[media_items.MediaRecord]:
    """What still lacks a proxy, the project's own media first (then what was just found)."""
    todo = [
        r
        for r in records
        if not r.proxy_ready and not r.missing and (folder, r.item.id) not in _failed
    ]
    return sorted(todo, key=lambda r: not r.included)


def build_pending(slug: str) -> int:
    """Build every missing proxy now, one after another. Returns how many were built."""
    folder = project_folder(slug)
    built = 0
    while True:
        todo = needed(str(folder), media_items.list_media(slug, with_available=True))
        if not todo:
            return built
        item = todo[0].item
        try:
            proxies.build_proxy(lib.media_file(folder, item.path), item, folder)
            built += 1
        except Exception:  # an unreadable or odd file must not stop the others
            log.warning("autoproxy_failed", folder=str(folder), path=item.path)
            _failed.add((str(folder), item.id))


def ensure(slug: str, records: list[media_items.MediaRecord]) -> set[str]:
    """Start the builder if anything lacks a proxy; the ids it has queued (or is building)."""
    folder = str(project_folder(slug))
    queued = {r.item.id for r in needed(folder, records)}
    if not queued:
        return set()
    with _lock:
        start = folder not in _working
        _working.add(folder)

    def work() -> None:
        try:
            build_pending(slug)
        finally:
            with _lock:
                _working.discard(folder)

    if start:
        _spawn(work)
    return queued

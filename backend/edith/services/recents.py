"""The list of recently opened projects: Edith's only state outside the projects themselves.

Projects are self-contained folders anywhere on disk, so there is nothing to scan for: you create
one or open one, and it goes on this list. An entry whose folder has gone (a drive unplugged) stays
until you forget it, so it is there when the drive comes back.
"""

import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

MAX_RECENTS = 50
_FILE = "recent-projects.json"


@dataclass
class Recent:
    folder: str  # absolute path of the project's folder
    name: str
    last_opened: str  # ISO time


def _path(state_dir: Path) -> Path:
    return state_dir / _FILE


def load(state_dir: Path) -> list[Recent]:
    try:
        raw = json.loads(_path(state_dir).read_text())
        return [Recent(**r) for r in raw]
    except (OSError, ValueError, TypeError):
        return []


def _save(state_dir: Path, recents: list[Recent]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    tmp = _path(state_dir).with_suffix(".tmp")
    tmp.write_text(json.dumps([asdict(r) for r in recents], indent=1))
    os.replace(tmp, _path(state_dir))


def remember(state_dir: Path, folder: Path, name: str) -> None:
    """Put a project at the top of the list (adding it, or refreshing its name and time)."""
    key = str(folder)
    rest = [r for r in load(state_dir) if r.folder != key]
    now = datetime.now(UTC).isoformat(timespec="seconds")
    _save(state_dir, [Recent(key, name, now), *rest][:MAX_RECENTS])


def forget(state_dir: Path, folder: Path) -> None:
    key = str(folder)
    _save(state_dir, [r for r in load(state_dir) if r.folder != key])


def add_if_missing(state_dir: Path, folder: Path, name: str) -> bool:
    """Add a project to the end of the list unless it is on it already (for imports)."""
    key = str(folder)
    existing = load(state_dir)
    if any(r.folder == key for r in existing):
        return False
    now = datetime.now(UTC).isoformat(timespec="seconds")
    _save(state_dir, [*existing, Recent(key, name, now)][:MAX_RECENTS])
    return True

"""The list of recently opened projects: Edith's only state outside the projects themselves.

A project is a `.edith` file (in a folder with its media) anywhere on disk, so there is nothing
to scan for: you create or open one, and it goes on this list by the file's absolute path. One
whose file has gone (a drive unplugged) stays until you forget it, so it is back with the drive.
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
    file: str  # absolute path of the project's .edith file
    name: str
    last_opened: str  # ISO time


def _path(state_dir: Path) -> Path:
    return state_dir / _FILE


def _upgraded(raw: dict) -> Recent:
    """One stored entry. The first version of the list stored the project's folder, not its file."""
    if "file" in raw:
        return Recent(**raw)
    folder = Path(raw["folder"])
    found = sorted(folder.glob("*.edith")) if folder.is_dir() else []
    default = folder / "project.edith"
    file = default if default.exists() or len(found) != 1 else found[0]
    return Recent(str(file), raw["name"], raw["last_opened"])


def load(state_dir: Path) -> list[Recent]:
    try:
        return [_upgraded(r) for r in json.loads(_path(state_dir).read_text())]
    except (OSError, ValueError, TypeError, KeyError):
        return []


def _save(state_dir: Path, recents: list[Recent]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    tmp = _path(state_dir).with_suffix(".tmp")
    tmp.write_text(json.dumps([asdict(r) for r in recents], indent=1))
    os.replace(tmp, _path(state_dir))


def remember(state_dir: Path, file: Path, name: str) -> None:
    """Put a project at the top of the list (adding it, or refreshing its name and time)."""
    key = str(file)
    rest = [r for r in load(state_dir) if r.file != key]
    now = datetime.now(UTC).isoformat(timespec="seconds")
    _save(state_dir, [Recent(key, name, now), *rest][:MAX_RECENTS])


def forget(state_dir: Path, file: Path) -> None:
    key = str(file)
    _save(state_dir, [r for r in load(state_dir) if r.file != key])


def add_if_missing(state_dir: Path, file: Path, name: str) -> bool:
    """Add a project to the end of the list unless it is on it already (for imports)."""
    key = str(file)
    existing = load(state_dir)
    if any(r.file == key for r in existing):
        return False
    now = datetime.now(UTC).isoformat(timespec="seconds")
    _save(state_dir, [*existing, Recent(key, name, now)][:MAX_RECENTS])
    return True

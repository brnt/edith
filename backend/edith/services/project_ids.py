"""Project ids: a random GUID per project file, kept in Edith's state folder.

A project's id (its "slug", the `#/p/<id>` in the address bar) used to be its file's absolute path,
encoded: stateless, but long and ugly. Now each `.edith` file Edith has met gets a GUID, and this
small map (`project-ids.json` beside the recent list) says which file it is. Ids are never
reused, and forgetting a project from the recent list keeps its id, so an open tab keeps working.
A project that moves on disk is a new file to Edith and gets a new id.
"""

import json
import os
import threading
import uuid
from pathlib import Path

_FILE = "project-ids.json"
_lock = threading.Lock()


def _load(state_dir: Path) -> dict[str, str]:
    try:
        data = json.loads((state_dir / _FILE).read_text())
        return {str(k): str(v) for k, v in data.items()}
    except (OSError, ValueError, AttributeError):
        return {}


def _save(state_dir: Path, ids: dict[str, str]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    tmp = (state_dir / _FILE).with_suffix(".tmp")
    tmp.write_text(json.dumps(ids, indent=1))
    os.replace(tmp, state_dir / _FILE)


def id_for(state_dir: Path, file: Path) -> str:
    """The project file's id: its existing one, or a new GUID."""
    key = str(file)
    with _lock:
        ids = _load(state_dir)
        for uid, path in ids.items():
            if path == key:
                return uid
        uid = str(uuid.uuid4())
        ids[uid] = key
        _save(state_dir, ids)
        return uid


def file_for(state_dir: Path, uid: str) -> Path | None:
    """The project file an id names, or None when this Edith has never issued it."""
    path = _load(state_dir).get(uid)
    return Path(path) if path else None

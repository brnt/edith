import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from edith.core.errors import (
    NotAProjectFile,
    ProjectExists,
    ProjectNotFound,
    ReadOnlyProject,
    UnsupportedVersion,
)
from edith.db.documents import Document, DocumentKind
from edith.db.project_file import ProjectFile


class NoteV3(Document):
    text: str
    pinned: bool


def _v1_to_v2(body: dict[str, Any]) -> dict[str, Any]:
    return {"text": body["note"]}  # v1 called it "note"


def _v2_to_v3(body: dict[str, Any]) -> dict[str, Any]:
    return {**body, "pinned": False}  # v3 added "pinned"


NOTE = DocumentKind("note", 3, NoteV3, upcasters={1: _v1_to_v2, 2: _v2_to_v3})


def _insert_raw(path: Path, version: int, body: dict[str, Any]) -> None:
    conn = sqlite3.connect(path)
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO documents (kind, id, schema_version, body) "
            "VALUES ('note', 'n', ?, ?)",
            (version, json.dumps(body)),
        )
    conn.close()


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def path(tmp_path: Path) -> Path:
    target = tmp_path / "p.edith"
    ProjectFile.create(target).close()
    return target


def test_put_then_get_round_trips_at_current_version(path: Path):
    with ProjectFile.open(path, writable=True) as project:
        project.put(NOTE, "n", NoteV3(text="hi", pinned=True))
    with ProjectFile.open(path) as project:
        loaded = project.get(NOTE, "n")
    assert loaded is not None
    assert loaded.document.model_dump() == {"text": "hi", "pinned": True}
    assert not loaded.needs_upgrade


def test_get_missing_document_is_none(path: Path):
    with ProjectFile.open(path) as project:
        assert project.get(NOTE, "absent") is None


def test_old_version_is_upcast_through_every_step(path: Path):
    _insert_raw(path, 1, {"note": "from v1"})
    with ProjectFile.open(path) as project:
        loaded = project.get(NOTE, "n")
    assert loaded is not None
    assert loaded.document.model_dump() == {"text": "from v1", "pinned": False}
    assert loaded.stored_version == 1
    assert loaded.needs_upgrade


def test_opening_and_reading_never_modifies_the_file(path: Path):
    _insert_raw(path, 1, {"note": "old"})
    before_hash, before_mtime = _sha(path), path.stat().st_mtime_ns
    with ProjectFile.open(path) as project:
        assert project.get(NOTE, "n") is not None
    assert (_sha(path), path.stat().st_mtime_ns) == (before_hash, before_mtime)
    assert not list(path.parent.glob("*-journal")) and not list(path.parent.glob("*-wal"))


def test_saving_an_old_document_upgrades_it_in_place(path: Path):
    _insert_raw(path, 1, {"note": "old"})
    with ProjectFile.open(path, writable=True) as project:
        loaded = project.get(NOTE, "n")
        assert loaded is not None
        project.put(NOTE, "n", loaded.document)
    with ProjectFile.open(path) as project:
        reloaded = project.get(NOTE, "n")
    assert reloaded is not None
    assert reloaded.stored_version == 3 and not reloaded.needs_upgrade


def test_document_from_a_newer_version_is_refused(path: Path):
    _insert_raw(path, 4, {"text": "from the future"})
    with ProjectFile.open(path) as project, pytest.raises(UnsupportedVersion):
        project.get(NOTE, "n")


def test_unknown_fields_survive_a_round_trip(path: Path):
    _insert_raw(path, 3, {"text": "x", "pinned": False, "added_later": 7})
    with ProjectFile.open(path, writable=True) as project:
        loaded = project.get(NOTE, "n")
        assert loaded is not None
        project.put(NOTE, "n", loaded.document)
    stored = sqlite3.connect(path).execute("SELECT body FROM documents").fetchone()[0]
    assert json.loads(stored)["added_later"] == 7


def test_put_on_a_read_only_project_is_refused(path: Path):
    with ProjectFile.open(path) as project, pytest.raises(ReadOnlyProject):
        project.put(NOTE, "n", NoteV3(text="x", pinned=False))


def test_create_refuses_to_overwrite(path: Path):
    with pytest.raises(ProjectExists):
        ProjectFile.create(path)


def test_open_missing_file(tmp_path: Path):
    with pytest.raises(ProjectNotFound):
        ProjectFile.open(tmp_path / "nope.edith")


def test_open_rejects_a_file_that_is_not_a_project(tmp_path: Path):
    not_sqlite = tmp_path / "a.edith"
    not_sqlite.write_text("hello")
    other_db = tmp_path / "b.edith"
    sqlite3.connect(other_db).execute("CREATE TABLE t (x)").connection.close()
    for target in (not_sqlite, other_db):
        with pytest.raises(NotAProjectFile):
            ProjectFile.open(target)


def test_open_refuses_a_newer_container_format(path: Path):
    conn = sqlite3.connect(path)
    with conn:
        conn.execute("UPDATE meta SET value = '99' WHERE key = 'container_version'")
    conn.close()
    with pytest.raises(UnsupportedVersion):
        ProjectFile.open(path)

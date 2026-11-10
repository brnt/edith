"""Projects saved by an older Edith (see tests/fixtures/projects). Opening must never write."""

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from edith.db.documents import EDIT
from edith.db.project_file import ProjectFile

FIXTURES = Path(__file__).parent.parent / "fixtures" / "projects"


def install(library: Path, fixture: str, slug: str = "old-show") -> Path:
    """Write a project file whose documents carry the versions they were saved with."""
    folder = library / slug
    folder.mkdir()
    ProjectFile.create(folder / "project.edith").close()
    conn = sqlite3.connect(folder / "project.edith")
    with conn:
        for doc in json.loads((FIXTURES / fixture).read_text())["documents"]:
            conn.execute(
                "INSERT INTO documents (kind, id, schema_version, body) VALUES (?, ?, ?, ?)",
                (doc["kind"], doc["id"], doc["schema_version"], json.dumps(doc["body"])),
            )
    conn.close()
    return folder / "project.edith"


def fingerprint(path: Path) -> tuple[str, int]:
    return hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns


def test_a_v1_project_opens_reads_as_current_and_is_left_untouched(client: TestClient, library):
    path = install(library, "v1_with_still_overlays.json")
    before = fingerprint(path)

    summary = client.get("/projects/old-show").json()
    assert summary["needs_upgrade"] is True and summary["name"] == "Old Show"

    edit = client.get("/projects/old-show/edit").json()
    assert edit["needs_upgrade"] is True
    body = edit["edit"]
    assert "stills" not in body
    assert [(s["at_s"], s["media_id"]) for s in body["switches"]] == [
        (5.0, "camB"),
        (10.0, "car"),  # the still overlay is now a switch to it ...
        (14.0, "camA"),  # ... and back to what v1 showed there (the switch hidden at 12 s)
    ]
    assert body["a_field_from_the_future"] == 7  # unknown fields survive

    plan = client.get("/projects/old-show/plan").json()
    assert [(s["kind"], s["media_id"], s["rec_in_s"], s["dur_s"]) for s in plan["video"]] == [
        ("camera", "camA", 0, 5),  # the default camera before the first switch
        ("camera", "camB", 5, 5),
        ("still", "car", 10, 4),
        ("camera", "camA", 14, 6),
        ("camera", "camA", 20, 8),  # after the 2 s cut at 20-22 s
    ]
    assert plan["duration_s"] == pytest.approx(28.0)  # 30 s minus the 2 s cut

    assert fingerprint(path) == before  # nothing above wrote to the file


def test_saving_the_edit_rewrites_it_in_the_current_format(client: TestClient, library):
    path = install(library, "v1_with_still_overlays.json")
    edit = client.get("/projects/old-show/edit").json()["edit"]
    assert client.put("/projects/old-show/edit", json=edit).status_code == 200

    with ProjectFile.open(path) as project:
        loaded = project.get(EDIT, "edit")
    assert loaded is not None and loaded.stored_version == EDIT.current_version
    assert client.get("/projects/old-show").json()["needs_upgrade"] is False

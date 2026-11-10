"""Converting projects from the old library layout (a folder of projects, media named from it)."""

import json
import sqlite3
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from edith.core.config import get_settings
from edith.db.documents import (
    MEDIA,
    SYNC,
    SYNC_ID,
    MediaItem,
    SyncState,
    SyncTemplate,
)
from edith.db.project_file import LAYOUT_FOLDER, ProjectFile
from edith.services import recents
from edith.services.migration import BACKUP_SUFFIX, import_legacy_library
from edith.services.projects import slug_for
from tests.conftest import needs_ffmpeg, settled, write_video, write_wav

pytestmark = needs_ffmpeg


def _legacy_project(library: Path, name: str, items: list[tuple[str, str]], template: str | None):
    """A project as the old Edith saved it: no layout marker, media named from the library root."""
    from edith.db.documents import PROJECT_INFO, PROJECT_INFO_ID, ProjectInfo

    folder = library / name
    folder.mkdir(exist_ok=True)
    with ProjectFile.create(folder / "project.edith") as project:
        from datetime import UTC, datetime

        project.put(
            PROJECT_INFO,
            PROJECT_INFO_ID,
            ProjectInfo(name=name.title(), created_at=datetime.now(UTC)),
        )
        for media_id, path in items:
            project.put(
                MEDIA,
                media_id,
                MediaItem(
                    id=media_id,
                    path=path,
                    kind="video",
                    label=Path(path).name,
                    duration_s=2.0,
                    width=320,
                    height=180,
                    fps=30.0,
                    has_audio=True,
                ),
            )
        if template:
            project.put(SYNC, SYNC_ID, SyncState(template=SyncTemplate(kind="file", path=template)))
    conn = sqlite3.connect(folder / "project.edith")
    with conn:
        conn.execute("DELETE FROM meta WHERE key = 'layout'")  # what the old files looked like
    conn.close()
    return folder


def _paths(folder: Path) -> dict[str, str]:
    with ProjectFile.open(folder / "project.edith") as project:
        return {d.doc_id: d.document.path for d in project.documents_of(MEDIA)}  # type: ignore[union-attr]


def test_existing_projects_are_converted_keeping_ids_and_footage_where_it_is(
    client: TestClient, workspace: Path
):
    library = workspace / "library"
    library.mkdir()
    settled(write_video(library / "media" / "cam.mp4"))  # shared footage, outside the project
    settled(write_wav(library / "ref" / "chirp.wav", np.zeros(44_100)))
    settled(write_video(library / "show" / "inside.mp4"))  # footage inside the project folder
    settled(write_wav(library / "loose.wav", np.zeros(44_100)))  # a file at the library's top
    folder = _legacy_project(
        library,
        "show",
        [
            ("outside", "media/cam.mp4"),
            ("inside", "show/inside.mp4"),
            ("loose", "loose.wav"),
        ],
        template="ref/chirp.wav",
    )
    (folder / "cache" / "proxy").mkdir(parents=True)
    (folder / "cache" / "proxy" / "outside.mp4").write_bytes(b"built proxy")

    done = import_legacy_library(library, get_settings().state_dir)

    assert [(c.folder, c.media) for c in done] == [("show", 3)]
    assert _paths(folder) == {
        "outside": "media/cam.mp4",  # unchanged: reached through a link in the project folder
        "inside": "inside.mp4",  # the folder's own prefix is dropped
        "loose": "loose.wav",
    }
    assert (folder / "media").is_symlink() and (folder / "media" / "cam.mp4").is_file()
    assert (folder / "loose.wav").is_symlink() and (folder / "ref").is_symlink()
    assert not (library / "media" / "show").exists()  # nothing was moved or copied into the library
    with ProjectFile.open(folder / "project.edith") as project:
        assert project.layout() == LAYOUT_FOLDER
        sync = project.get(SYNC, SYNC_ID)
        assert sync is not None and sync.document.template.path == "ref/chirp.wav"  # type: ignore[union-attr]
    assert (folder / ("project.edith" + BACKUP_SUFFIX)).is_file()  # the old file is kept
    assert (folder / ".edith" / "proxy" / "outside.mp4").read_bytes() == b"built proxy"
    assert not (folder / "cache").exists()

    # It is on the recent list by absolute path, and everything in it reads from the new place.
    (project,) = client.get("/projects").json()
    assert project["folder"] == str(folder.resolve()) and project["available"] is True
    media = {m["id"]: m for m in client.get(f"/projects/{project['slug']}/media").json()}
    assert {m["missing"] for m in media.values() if m["included"]} == {False}
    assert {i for i, m in media.items() if m["included"]} == {"outside", "inside", "loose"}


def test_converting_twice_changes_nothing_and_does_not_reorder_the_recent_list(
    client: TestClient, workspace: Path
):
    library = workspace / "library"
    library.mkdir()
    settled(write_video(library / "media" / "cam.mp4"))
    folder = _legacy_project(library, "show", [("outside", "media/cam.mp4")], template=None)
    state = get_settings().state_dir
    import_legacy_library(library, state)
    snapshot = (folder / "project.edith").read_bytes()
    client.post("/projects", json={"name": "Newer", "folder": str(workspace / "newer")})
    order = [r.name for r in recents.load(state)]

    assert import_legacy_library(library, state) == []
    assert (folder / "project.edith").read_bytes() == snapshot
    assert [r.name for r in recents.load(state)] == order  # not pushed back to the top


def test_a_name_already_taken_in_the_project_folder_gets_a_different_link_name(
    workspace: Path,
):
    library = workspace / "library"
    library.mkdir()
    settled(write_video(library / "media" / "cam.mp4"))
    folder = _legacy_project(library, "show", [("outside", "media/cam.mp4")], template=None)
    (folder / "media").mkdir()  # a real folder of the project's own, in the way
    import_legacy_library(library, get_settings().state_dir)
    assert _paths(folder) == {"outside": "linked-media/cam.mp4"}
    assert (folder / "linked-media" / "cam.mp4").is_file()


def test_converted_projects_are_found_by_slug_and_a_broken_one_does_not_stop_the_rest(
    client: TestClient, workspace: Path
):
    library = workspace / "library"
    library.mkdir()
    (library / "broken").mkdir()
    (library / "broken" / "project.edith").write_text("not sqlite")
    folder = _legacy_project(library, "good", [], template=None)
    done = import_legacy_library(library, get_settings().state_dir)
    assert [c.folder for c in done] == ["good"]
    assert client.get(f"/projects/{slug_for(folder.resolve())}").json()["name"] == "Good"
    assert json.loads((get_settings().state_dir / "recent-projects.json").read_text())

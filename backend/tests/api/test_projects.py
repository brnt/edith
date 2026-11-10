import json
from pathlib import Path

from fastapi.testclient import TestClient

from edith.core.config import get_settings


def _recents_file() -> Path:
    return get_settings().state_dir / "recent-projects.json"


def test_health(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ok"}


def test_a_project_is_created_in_the_folder_you_choose(client: TestClient, workspace: Path):
    folder = workspace / "Miata Day" / "footage"  # does not exist yet
    created = client.post(
        "/projects", json={"name": "Episode 12: Miata Day", "folder": str(folder)}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Episode 12: Miata Day"
    assert body["folder"] == str(folder) and body["available"] is True
    assert body["needs_upgrade"] is False
    assert (folder / "project.edith").is_file()
    # The slug is the folder: fetching by it works, and nothing else is needed to find it.
    assert client.get(f"/projects/{body['slug']}").json()["folder"] == str(folder)


def test_recent_projects_are_remembered_with_their_absolute_folders(
    client: TestClient, workspace: Path
):
    a, b = workspace / "a", workspace / "b"
    client.post("/projects", json={"name": "A", "folder": str(a)})
    client.post("/projects", json={"name": "B", "folder": str(b)})
    listed = client.get("/projects").json()
    assert [p["name"] for p in listed] == ["B", "A"]  # newest first
    assert [p["folder"] for p in listed] == [str(b), str(a)]
    stored = json.loads(_recents_file().read_text())
    assert [r["folder"] for r in stored] == [str(b), str(a)]  # absolute paths on disk too


def test_opening_a_project_moves_it_to_the_top_and_remembers_one_from_elsewhere(
    client: TestClient, workspace: Path
):
    a = client.post("/projects", json={"name": "A", "folder": str(workspace / "a")}).json()
    client.post("/projects", json={"name": "B", "folder": str(workspace / "b")})
    assert client.post(f"/projects/{a['slug']}/opened").status_code == 204
    assert [p["name"] for p in client.get("/projects").json()] == ["A", "B"]

    # A project that isn't on the list (a folder copied from another machine) is opened by folder.
    client.delete(f"/projects/{a['slug']}/recent")
    assert [p["name"] for p in client.get("/projects").json()] == ["B"]
    reopened = client.post("/projects/open", json={"folder": str(workspace / "a")})
    assert reopened.status_code == 200 and reopened.json()["name"] == "A"
    assert [p["name"] for p in client.get("/projects").json()] == ["A", "B"]


def test_forgetting_a_project_leaves_its_folder_alone(client: TestClient, workspace: Path):
    folder = workspace / "keep"
    slug = client.post("/projects", json={"name": "Keep", "folder": str(folder)}).json()["slug"]
    assert client.delete(f"/projects/{slug}/recent").status_code == 204
    assert client.get("/projects").json() == []
    assert (folder / "project.edith").is_file()


def test_a_project_whose_folder_is_gone_stays_on_the_list_marked_unavailable(
    client: TestClient, workspace: Path
):
    folder = workspace / "drive"
    client.post("/projects", json={"name": "On a drive", "folder": str(folder)})
    (folder / "project.edith").rename(workspace / "elsewhere.edith")  # the drive went away
    (project,) = client.get("/projects").json()
    assert project["name"] == "On a drive" and project["available"] is False
    assert project["created_at"] is None


def test_opening_a_folder_without_a_project_is_refused(client: TestClient, workspace: Path):
    (workspace / "empty").mkdir()
    response = client.post("/projects/open", json={"folder": str(workspace / "empty")})
    assert response.status_code == 404, response.text


def test_projects_cant_nest_or_collide(client: TestClient, workspace: Path):
    folder = workspace / "show"
    assert client.post("/projects", json={"name": "One", "folder": str(folder)}).status_code == 201
    same = client.post("/projects", json={"name": "Two", "folder": str(folder)})
    inside = client.post("/projects", json={"name": "Two", "folder": str(folder / "cut2")})
    assert same.status_code == 409 and inside.status_code == 409


def test_create_requires_token(client: TestClient, workspace: Path):
    denied = client.post(
        "/projects",
        json={"name": "nope", "folder": str(workspace / "x")},
        headers={"Authorization": "Bearer wrong"},
    )
    assert denied.status_code == 401, denied.text


def test_unusable_names_and_relative_folders_are_rejected(client: TestClient, workspace: Path):
    assert (
        client.post("/projects", json={"name": "  ", "folder": str(workspace / "x")}).status_code
        == 422
    )
    assert (
        client.post("/projects", json={"name": "Ok", "folder": "relative/path"}).status_code == 422
    )


def test_unknown_and_malformed_slugs_are_404(client: TestClient):
    assert client.get("/projects/missing").status_code == 404
    assert client.get("/projects/%00").status_code == 404


def test_the_folder_browser_lists_folders_and_marks_projects(client: TestClient, workspace: Path):
    (workspace / "plain").mkdir()
    (workspace / ".hidden").mkdir()
    (workspace / "a file.txt").write_text("x")
    client.post("/projects", json={"name": "P", "folder": str(workspace / "proj")})
    listing = client.get("/fs/folders", params={"dir": str(workspace)}).json()
    assert listing["dir"] == str(workspace) and listing["parent"] == str(workspace.parent)
    assert [(e["name"], e["is_project"]) for e in listing["entries"]] == [
        ("plain", False),
        ("proj", True),
    ]
    inside = client.get("/fs/folders", params={"dir": str(workspace / "proj")}).json()
    assert inside["is_project"] is True
    assert client.get("/fs/folders", params={"dir": "relative"}).status_code == 422
    assert client.get("/fs/folders", params={"dir": str(workspace / "nope")}).status_code == 422
    assert client.get("/fs/folders").json()["dir"] == str(Path.home())  # starts at home
    assert any(p["name"] == "Home" for p in client.get("/fs/places").json())


def test_upgrade_is_explicit_and_idempotent(client: TestClient, workspace: Path):
    slug = client.post("/projects", json={"name": "Old", "folder": str(workspace / "old")}).json()[
        "slug"
    ]
    upgraded = client.post(f"/projects/{slug}/upgrade")
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["needs_upgrade"] is False

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
    assert [p["file"] for p in listed] == [str(b / "project.edith"), str(a / "project.edith")]
    stored = json.loads(_recents_file().read_text())
    assert [r["file"] for r in stored] == [str(b / "project.edith"), str(a / "project.edith")]


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
    reopened = client.post("/projects/open", json={"path": str(workspace / "a")})
    assert reopened.status_code == 200 and reopened.json()["name"] == "A"
    assert [p["name"] for p in client.get("/projects").json()] == ["A", "B"]


def test_forgetting_a_project_leaves_its_folder_alone(client: TestClient, workspace: Path):
    folder = workspace / "keep"
    slug = client.post("/projects", json={"name": "Keep", "folder": str(folder)}).json()["slug"]
    assert client.delete(f"/projects/{slug}/recent").status_code == 204
    assert client.get("/projects").json() == []
    assert (folder / "project.edith").is_file()


def test_a_project_whose_file_is_gone_is_left_off_the_list_and_returns_with_the_file(
    client: TestClient, workspace: Path
):
    folder = workspace / "drive"
    client.post("/projects", json={"name": "On a drive", "folder": str(folder)})
    (folder / "project.edith").rename(workspace / "elsewhere.edith")  # the drive went away
    assert client.get("/projects").json() == []  # no error entry: just not there
    (workspace / "elsewhere.edith").rename(folder / "project.edith")  # and it came back
    (project,) = client.get("/projects").json()
    assert project["name"] == "On a drive" and project["available"] is True


def test_opening_a_folder_without_a_project_is_refused(client: TestClient, workspace: Path):
    (workspace / "empty").mkdir()
    response = client.post("/projects/open", json={"path": str(workspace / "empty")})
    assert response.status_code == 404, response.text


def test_a_second_project_can_share_a_folder_but_projects_cant_nest(
    client: TestClient, workspace: Path
):
    folder = workspace / "show"
    first = client.post("/projects", json={"name": "Cut A", "folder": str(folder)})
    second = client.post("/projects", json={"name": "Cut B", "folder": str(folder)})
    assert first.status_code == second.status_code == 201
    assert first.json()["file"] == str(folder / "project.edith")
    assert second.json()["file"] == str(folder / "Cut B.edith")  # named after the project
    assert first.json()["folder"] == second.json()["folder"] == str(folder)
    assert first.json()["slug"] != second.json()["slug"]  # two projects, one folder
    # The same name again is not an overwrite: it is numbered. But a folder inside a project's
    # folder (its media) can't hold another project.
    again = client.post("/projects", json={"name": "Cut B", "folder": str(folder)})
    assert again.status_code == 201 and again.json()["name"] == "Cut B 2"
    assert second.json()["file"] != again.json()["file"]
    inside = client.post("/projects", json={"name": "Deeper", "folder": str(folder / "cut2")})
    assert inside.status_code == 409


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
    nope = client.get("/fs/folders", headers={"Authorization": "Bearer wrong"})
    assert nope.status_code == 401  # browsing the disk needs the token too
    assert any(p["name"] == "Home" for p in client.get("/fs/places").json())


def test_upgrade_is_explicit_and_idempotent(client: TestClient, workspace: Path):
    slug = client.post("/projects", json={"name": "Old", "folder": str(workspace / "old")}).json()[
        "slug"
    ]
    upgraded = client.post(f"/projects/{slug}/upgrade")
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["needs_upgrade"] is False


def test_a_folder_with_an_edith_file_opens_whatever_the_file_is_called(
    client: TestClient, workspace: Path
):
    made = client.post(
        "/projects", json={"name": "Renamed", "folder": str(workspace / "ep")}
    ).json()
    (workspace / "ep" / "project.edith").rename(workspace / "ep" / "Miata Day.edith")
    client.delete(f"/projects/{made['slug']}/recent")

    listing = client.get("/fs/folders", params={"dir": str(workspace)}).json()
    assert [(e["name"], e["is_project"], e["edith_files"]) for e in listing["entries"]] == [
        ("ep", True, 1)
    ]
    opened = client.post("/projects/open", json={"path": str(workspace / "ep")})  # by its folder
    assert opened.status_code == 200 and opened.json()["name"] == "Renamed"
    assert opened.json()["file"] == str(workspace / "ep" / "Miata Day.edith")
    assert client.get(f"/projects/{opened.json()['slug']}/media").status_code == 200  # and it works


def test_with_several_edith_files_you_choose_one_and_shadow_files_are_ignored(
    client: TestClient, workspace: Path
):
    folder = workspace / "two"
    client.post("/projects", json={"name": "Cut A", "folder": str(folder)})
    client.post("/projects", json={"name": "Cut B", "folder": str(folder)})
    (folder / "._Cut B.edith").write_bytes(b"AppleDouble shadow")  # macOS junk on external drives

    listing = client.get("/fs/folders", params={"dir": str(folder)}).json()
    assert [f["name"] for f in listing["files"]] == ["Cut B.edith", "project.edith"]
    assert listing["is_project"] is True
    # project.edith wins when a folder is opened without choosing...
    assert client.post("/projects/open", json={"path": str(folder)}).json()["name"] == "Cut A"
    # ...and with no project.edith it's ambiguous, but naming the file is always unambiguous.
    (folder / "project.edith").rename(folder / "Cut A.edith")
    ambiguous = client.post("/projects/open", json={"path": str(folder)})
    assert ambiguous.status_code == 409 and "choose one" in ambiguous.json()["message"]
    chosen = client.post("/projects/open", json={"path": str(folder / "Cut B.edith")})
    assert chosen.status_code == 200 and chosen.json()["name"] == "Cut B"


def test_a_recent_list_from_before_files_were_the_identity_still_loads(
    client: TestClient, workspace: Path
):
    made = client.post(
        "/projects", json={"name": "Old list", "folder": str(workspace / "o")}
    ).json()
    # The first version of the list stored the folder (not the file) under "folder".
    _recents_file().write_text(
        json.dumps(
            [{"folder": str(workspace / "o"), "name": "Old list", "last_opened": "2026-11-10"}]
        )
    )
    (listed,) = client.get("/projects").json()
    assert listed["slug"] == made["slug"] and listed["file"] == str(
        workspace / "o" / "project.edith"
    )


def test_project_ids_are_guids_that_stay_the_same_for_a_file(client: TestClient, workspace: Path):
    import uuid

    made = client.post("/projects", json={"name": "Show", "folder": str(workspace / "show")}).json()
    uuid.UUID(made["slug"])  # not the path, just a GUID
    assert str(workspace) not in made["slug"]
    reopened = client.post("/projects/open", json={"path": made["file"]}).json()
    assert reopened["slug"] == made["slug"]  # the same file is the same project
    assert client.get(f"/projects/{made['slug']}").json()["name"] == "Show"
    listed = client.get("/projects").json()
    assert [p["slug"] for p in listed] == [made["slug"]]
    # Forgetting it from the recent list keeps its id, so an open tab still works.
    client.delete(f"/projects/{made['slug']}")
    assert client.get(f"/projects/{made['slug']}").status_code == 200


def test_an_unknown_or_malformed_project_id_is_not_found(client: TestClient):
    import uuid

    assert client.get(f"/projects/{uuid.uuid4()}").status_code == 404
    assert client.get("/projects/not-a-guid").status_code == 404
    assert client.get("/projects/L3RtcC9hLmVkaXRo").status_code == 404  # an old path-style id


def test_a_new_folder_is_made_in_the_chosen_place_with_helpful_errors(
    client: TestClient, workspace: Path
):
    made = client.post("/fs/folders", json={"parent": str(workspace), "name": " Episode 12 "})
    assert made.status_code == 201
    assert (workspace / "Episode 12").is_dir()
    assert "Episode 12" in [e["name"] for e in made.json()["entries"]]  # the listing of the parent
    again = client.post("/fs/folders", json={"parent": str(workspace), "name": "Episode 12"})
    assert again.status_code == 409 and "already exists" in again.json()["message"]
    for bad in ("", "  ", "a/b", ".hidden"):
        r = client.post("/fs/folders", json={"parent": str(workspace), "name": bad})
        assert r.status_code == 422, bad
    assert "dot" in r.json()["message"]
    nope = client.post("/fs/folders", json={"parent": str(workspace / "nope"), "name": "x"})
    assert nope.status_code == 422
    denied = client.post(
        "/fs/folders",
        json={"parent": str(workspace), "name": "x"},
        headers={"Authorization": "Bearer wrong"},
    )
    assert denied.status_code == 401


def test_places_say_what_kind_each_is(client: TestClient):
    places = client.get("/fs/places").json()
    assert places[0]["name"] == "Home" and places[0]["kind"] == "home"
    assert {p["kind"] for p in places} <= {"home", "drive"}


def test_projects_named_after_their_folder_get_numbers_when_a_folder_holds_several(
    client: TestClient, workspace: Path
):
    folder = str(workspace / "show")
    made = [
        client.post("/projects", json={"name": "show", "folder": folder}).json() for _ in range(3)
    ]
    assert [m["name"] for m in made] == ["show", "show 2", "show 3"]
    assert [Path(m["file"]).name for m in made] == ["project.edith", "show 2.edith", "show 3.edith"]


def test_projects_sharing_a_folder_each_list_only_their_own_renders(
    client: TestClient, workspace: Path
):
    folder = workspace / "show"
    a = client.post("/projects", json={"name": "Cut A", "folder": str(folder)}).json()
    b = client.post("/projects", json={"name": "Cut B", "folder": str(folder)}).json()
    renders = folder / "renders"
    renders.mkdir()
    for name in ("Cut-A-20261112-100000.mp4", "Cut-B-20261112-110000.mov", "notes.mp4"):
        (renders / name).write_bytes(b"x")
    assert [r["name"] for r in client.get(f"/projects/{a['slug']}/renders").json()] == [
        "Cut-A-20261112-100000.mp4"
    ]
    assert [r["name"] for r in client.get(f"/projects/{b['slug']}/renders").json()] == [
        "Cut-B-20261112-110000.mov"
    ]


def test_a_folder_listing_names_the_media_files_edith_can_use(client: TestClient, workspace: Path):
    folder = workspace / "shoot"
    folder.mkdir()
    for name in ("b.MP4", "a.wav", "c.jpg", "notes.txt", "project.edith", ".hidden.mp4", "._a.wav"):
        (folder / name).write_bytes(b"x")
    (folder / "sub").mkdir()
    listing = client.get("/fs/folders", params={"dir": str(folder)}).json()
    assert [(m["name"], m["kind"]) for m in listing["media"]] == [
        ("a.wav", "audio"),
        ("b.MP4", "video"),
        ("c.jpg", "image"),
    ]  # supported types only, by name; not text, hidden, shadow or project files, or folders
    assert listing["media_more"] == 0
    assert [e["name"] for e in listing["entries"]] == ["sub"]


def test_a_big_folder_lists_the_first_few_hundred_and_counts_the_rest(
    client: TestClient, workspace: Path, monkeypatch
):
    from edith.services import filesystem

    monkeypatch.setattr(filesystem, "MAX_MEDIA_LISTED", 3)
    folder = workspace / "card"
    folder.mkdir()
    for i in range(5):
        (folder / f"clip{i}.mp4").write_bytes(b"x")
    listing = client.get("/fs/folders", params={"dir": str(folder)}).json()
    assert [m["name"] for m in listing["media"]] == ["clip0.mp4", "clip1.mp4", "clip2.mp4"]
    assert listing["media_more"] == 2


def test_recents_are_listed_with_the_most_recently_opened_first(
    client: TestClient, workspace: Path
):
    from edith.core.config import get_settings
    from edith.services import recents

    made = [
        client.post("/projects", json={"name": n, "folder": str(workspace / n)}).json()
        for n in ("one", "two", "three")
    ]
    state = get_settings().state_dir
    # Out of order in the file (as imports are), with times that say which was opened when.
    entries = recents.load(state)
    stamped = {"one": "2026-11-12T09:00:00+00:00", "two": "2026-11-12T11:00:00+00:00",
               "three": "2026-11-12T10:00:00+00:00"}  # fmt: skip
    for r in entries:
        r.last_opened = stamped[r.name]
    recents._save(state, entries)
    assert [p["name"] for p in client.get("/projects").json()] == ["two", "three", "one"]
    # Opening one puts it at the top.
    assert client.post(f"/projects/{made[0]['slug']}/opened").status_code == 204
    assert client.get("/projects").json()[0]["name"] == "one"

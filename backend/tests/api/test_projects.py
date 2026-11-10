from pathlib import Path

from fastapi.testclient import TestClient


def test_health(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ok"}


def test_create_list_and_get_project(client: TestClient, library: Path):
    created = client.post("/projects", json={"name": "Episode 12: Miata Day"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["slug"] == "episode-12-miata-day"
    assert body["name"] == "Episode 12: Miata Day"
    assert body["needs_upgrade"] is False
    assert (library / "episode-12-miata-day" / "project.edith").is_file()

    listed = client.get("/projects")
    assert listed.status_code == 200, listed.text
    assert [p["slug"] for p in listed.json()] == ["episode-12-miata-day"]

    fetched = client.get("/projects/episode-12-miata-day")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["name"] == "Episode 12: Miata Day"


def test_create_requires_token(client: TestClient):
    denied = client.post(
        "/projects", json={"name": "nope"}, headers={"Authorization": "Bearer wrong"}
    )
    assert denied.status_code == 401, denied.text


def test_duplicate_name_conflicts(client: TestClient):
    assert client.post("/projects", json={"name": "Same"}).status_code == 201
    again = client.post("/projects", json={"name": "same"})
    assert again.status_code == 409, again.text


def test_unusable_name_is_rejected(client: TestClient):
    response = client.post("/projects", json={"name": "!!!"})
    assert response.status_code == 422, response.text


def test_unknown_and_traversal_slugs_are_404(client: TestClient):
    assert client.get("/projects/missing").status_code == 404
    assert client.get("/projects/..%2F..%2Fetc").status_code == 404


def test_library_listing_skips_unreadable_projects(client: TestClient, library: Path):
    client.post("/projects", json={"name": "Good"})
    broken = library / "broken"
    broken.mkdir()
    (broken / "project.edith").write_text("not sqlite")
    listed = client.get("/projects")
    assert listed.status_code == 200, listed.text
    assert [p["slug"] for p in listed.json()] == ["good"]

"""Opt-in tests against a running stack (`just up`, then `just test-live`)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.live

TOKEN = os.environ.get("API_TOKEN", "dev-token")
BASE_URL = os.environ.get("API_URL", "http://localhost:8000")
# Where the test project goes: a folder the running stack can see at this same path (under Docker
# Compose that is anywhere in EDITH_MOUNT, your home folder by default).
LIVE_PARENT = Path(os.environ.get("LIVE_PROJECT_PARENT", Path.home() / ".edith-live-tests"))


@pytest.fixture
def live() -> Iterator[httpx.Client]:
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with httpx.Client(base_url=BASE_URL, headers=headers, timeout=10.0) as client:
        try:
            health = client.get("/health")
        except httpx.RequestError as exc:
            pytest.skip(f"stack not reachable at {BASE_URL}: {exc}")
        if health.status_code != 200:
            pytest.skip(f"health returned {health.status_code}: {health.text}")
        yield client


def test_health_and_auth(live: httpx.Client) -> None:
    health = live.get("/health")
    assert health.status_code == 200, health.text
    assert health.json()["status"] == "ok"

    with httpx.Client(base_url=BASE_URL, timeout=10.0) as unauth:
        denied = unauth.post("/projects", json={"name": "nope", "folder": str(LIVE_PARENT / "x")})
        assert denied.status_code == 401, denied.text


def test_create_project_writes_file_in_the_chosen_folder(live: httpx.Client) -> None:
    name = f"live-{uuid.uuid4().hex[:8]}"
    folder = LIVE_PARENT / name
    created = live.post("/projects", json={"name": name, "folder": str(folder)})
    assert created.status_code == 201, created.text
    slug = created.json()["slug"]

    host_file = folder / "project.edith"
    assert host_file.is_file(), f"expected {host_file} on the host bind mount"

    fetched = live.get(f"/projects/{slug}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["name"] == name
    assert fetched.json()["folder"] == str(folder)

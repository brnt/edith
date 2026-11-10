import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.services.jobs import jobs
from edith.sync.registration import registration_burst
from tests.conftest import needs_ffmpeg, write_image, write_wav

pytestmark = needs_ffmpeg


def _recording(rate: int, seconds: float, tones: list[float], seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    audio = rng.normal(0, 0.003, int(seconds * rate))
    burst = registration_burst("stickshift", rate) * 0.05
    for t in tones:
        audio[int(t * rate) : int(t * rate) + len(burst)] += burst
    audio[int(seconds * rate * 0.5) :][: rate // 5] += rng.normal(0, 0.6, rate // 5)  # a loud clap
    return audio


@pytest.fixture
def session(client: TestClient, library, project):
    """A recorder and a camera-audio file that started 7.25 s later, plus a still."""
    write_wav(library / "media" / "zoom.wav", _recording(44_100, 50, [13.0, 43.0], 1))
    write_wav(library / "media" / "cam.wav", _recording(48_000, 40, [5.75, 35.75], 2), 48_000)
    write_image(library / "media" / "car.png")
    ids = {}
    for name in ("zoom.wav", "cam.wav", "car.png"):
        ids[name] = client.post(
            f"/projects/{project}/media", json={"path": f"media/{name}"}
        ).json()["id"]
    return ids


def _run(client, project, media_id, start, end):
    job = client.post(
        f"/projects/{project}/sync",
        json={"template": {"media_id": media_id, "start_s": start, "end_s": end}},
    )
    assert job.status_code == 202, job.text
    return jobs.wait(job.json()["id"])


def test_sync_job_places_files_and_saves_the_result(client: TestClient, project, session):
    assert client.get(f"/projects/{project}/sync").json()["results"] == {}

    done = _run(client, project, session["zoom.wav"], 13.0, 13.2)
    assert done.state == "done", done.error
    assert done.result == {"synced": 2, "files": 2}  # images are not synced

    state = client.get(f"/projects/{project}/sync").json()
    zoom, cam = state["results"][session["zoom.wav"]], state["results"][session["cam.wav"]]
    assert zoom["status"] == "synced" and zoom["start_s"] == pytest.approx(0.0, abs=0.002)
    assert cam["status"] == "synced" and cam["start_s"] == pytest.approx(7.25, abs=0.002)
    assert session["car.png"] not in state["results"]
    assert state["template"] == {"media_id": session["zoom.wav"], "start_s": 13.0, "end_s": 13.2}


def test_nudges_survive_a_re_sync(client: TestClient, project, session):
    _run(client, project, session["zoom.wav"], 13.0, 13.2)
    cam = session["cam.wav"]
    nudged = client.put(f"/projects/{project}/sync/nudges", json={"nudges": {cam: 0.04, "x": 0.0}})
    assert nudged.status_code == 200 and nudged.json()["nudges"] == {cam: 0.04}
    _run(client, project, session["zoom.wav"], 13.0, 13.2)
    assert client.get(f"/projects/{project}/sync").json()["nudges"] == {cam: 0.04}


@pytest.mark.parametrize("start,end", [(13.0, 13.0), (13.0, 30.0), (-1.0, 0.5), (200.0, 200.2)])
def test_unusable_template_excerpts_fail_the_job(client: TestClient, project, session, start, end):
    done = _run(client, project, session["zoom.wav"], start, end)
    assert done.state == "error" and "InvalidTemplate" in done.error


def test_unknown_template_media_fails_the_job(client: TestClient, project, session):
    assert _run(client, project, "nope", 1.0, 1.2).state == "error"


def test_sync_requires_the_token(client: TestClient, project):
    denied = client.post(
        f"/projects/{project}/sync",
        json={"template": {"media_id": "x", "start_s": 0, "end_s": 1}},
        headers={"Authorization": "Bearer no"},
    )
    assert denied.status_code == 401

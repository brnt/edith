import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.services.jobs import jobs
from edith.sync.registration import padded_wav, registration_burst
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
def session(client: TestClient, project_dir, project):
    """A recorder and a camera-audio file that started 7.25 s later, plus a still."""
    write_wav(project_dir / "media" / "zoom.wav", _recording(44_100, 50, [13.0, 43.0], 1))
    write_wav(project_dir / "media" / "cam.wav", _recording(48_000, 40, [5.75, 35.75], 2), 48_000)
    write_image(project_dir / "media" / "car.png")
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
    template = state["template"]
    assert template["kind"] == "excerpt"
    assert (template["media_id"], template["start_s"], template["end_s"]) == (
        session["zoom.wav"],
        13.0,
        13.2,
    )


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


# --- other sources for the registration sound: a seed, or an audio file ---------------------


def _synced(client: TestClient, project, session) -> dict:
    results = client.get(f"/projects/{project}/sync").json()["results"]
    zoom, cam = results[session["zoom.wav"]], results[session["cam.wav"]]
    assert zoom["status"] == "synced" and zoom["start_s"] == pytest.approx(0.0, abs=0.002)
    assert cam["status"] == "synced" and cam["start_s"] == pytest.approx(7.25, abs=0.002)
    return results


def _sync_with(client: TestClient, project, template: dict):
    job = client.post(f"/projects/{project}/sync", json={"template": template})
    assert job.status_code == 202, job.text
    return jobs.wait(job.json()["id"])


def test_the_sound_can_be_generated_from_a_seed(client: TestClient, project, session):
    done = _sync_with(client, project, {"kind": "seed", "seed": "stickshift"})
    assert done.state == "done", done.error
    _synced(client, project, session)
    saved = client.get(f"/projects/{project}/sync").json()["template"]
    assert saved["kind"] == "seed" and saved["seed"] == "stickshift"


def test_the_sound_can_be_an_audio_file_padded_with_silence(
    client: TestClient, project, session, project_dir
):
    # Generated sounds come with silence either side; it must not stop the match.
    (project_dir / "reference.wav").write_bytes(padded_wav("stickshift", lead_s=0.5, tail_s=1.0))
    done = _sync_with(client, project, {"kind": "file", "path": "reference.wav"})
    assert done.state == "done", done.error
    _synced(client, project, session)
    assert client.get(f"/projects/{project}/sync").json()["template"]["path"] == "reference.wav"


def test_a_wrong_seed_still_partly_matches_but_scores_clearly_lower(client, project, session):
    """Bursts from different seeds share structure (about half their bits agree), so a wrong seed
    can still find the beeps. Only the match score tells them apart: this is why the UI shows it."""

    def zoom_score(seed: str) -> float:
        assert _sync_with(client, project, {"kind": "seed", "seed": seed}).state == "done"
        results = client.get(f"/projects/{project}/sync").json()["results"]
        return results[session["zoom.wav"]]["score"]

    right, wrong = zoom_score("stickshift"), zoom_score("something else")
    assert right > 0.9 > 0.8 > wrong


@pytest.mark.parametrize("path", ["media/car.png", "missing.wav", "media"])
def test_a_file_that_is_not_usable_audio_fails_the_job(client: TestClient, project, session, path):
    done = _sync_with(client, project, {"kind": "file", "path": path})
    assert done.state == "error", done.result


def test_a_silent_audio_file_fails_the_job(client: TestClient, project, session, project_dir):
    write_wav(project_dir / "silent.wav", np.zeros(44_100))
    done = _sync_with(client, project, {"kind": "file", "path": "silent.wav"})
    assert done.state == "error" and "InvalidTemplate" in done.error


@pytest.mark.parametrize(
    "template",
    [
        {"kind": "seed"},
        {"kind": "seed", "seed": ""},
        {"kind": "file"},
        {"kind": "excerpt", "media_id": "x"},
        {"kind": "nonsense", "seed": "x"},
    ],
)
def test_an_incomplete_template_is_rejected_up_front(client: TestClient, project, template):
    response = client.post(f"/projects/{project}/sync", json={"template": template})
    assert response.status_code == 422, response.text


def test_the_registration_sound_downloads_as_a_playable_wav(client: TestClient):
    response = client.get("/registration/sound", params={"seed": "stickshift"})
    assert response.status_code == 200 and response.headers["content-type"] == "audio/wav"
    assert 'filename="stickshift.wav"' in response.headers["content-disposition"]
    with wave.open(io.BytesIO(response.content)) as w:
        assert (w.getnchannels(), w.getframerate()) == (1, 44_100)
        assert w.getnframes() == pytest.approx(1.2 * 44_100, abs=2)  # 0.5 s + 0.2 s burst + 0.5 s
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16) / 32767
    burst = registration_burst("stickshift")
    start = int(0.5 * 44_100)
    assert np.corrcoef(samples[start : start + len(burst)], burst)[0, 1] > 0.999
    assert client.get("/registration/sound").status_code == 422  # a seed is required


def test_the_sound_file_is_named_after_its_seed_safely(client: TestClient):
    def disposition(seed: str) -> str:
        return client.get("/registration/sound", params={"seed": seed}).headers[
            "content-disposition"
        ]

    assert 'filename="my show.wav"' in disposition("my show")
    assert 'filename="a-b.wav"' in disposition("a/b")  # nothing a file name can't hold
    assert 'filename="registration.wav"' in disposition("...")  # nothing left of it
    unicode_name = disposition("café")
    assert (
        'filename="caf_.wav"' in unicode_name and "filename*=UTF-8''caf%C3%A9.wav" in unicode_name
    )


def test_the_registration_sound_source_is_a_setting_of_the_edit(client: TestClient, project):
    edit = client.get(f"/projects/{project}/edit").json()["edit"]
    assert edit["registration"] is None  # nothing chosen yet
    edit["registration"] = {"kind": "seed", "seed": "stickshift"}
    saved = client.put(f"/projects/{project}/edit", json=edit)
    assert saved.status_code == 200, saved.text
    again = client.get(f"/projects/{project}/edit").json()["edit"]
    assert again["registration"]["seed"] == "stickshift"  # saved with the edit, like the size


def test_a_marked_stretch_is_decoded_to_check_there_is_a_registration_sound_in_it(
    client: TestClient, project, session
):
    from edith.sync.registration import seed_bits

    def inspect(start, end, media="zoom.wav"):
        return client.get(
            f"/projects/{project}/sync/inspect",
            params={"media_id": session[media], "start_s": start, "end_s": end},
        )

    found = inspect(12.0, 14.0)  # the burst starts 1 s in
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["found"] is True and body["offset_s"] == pytest.approx(1.0, abs=0.01)
    assert body["code"] == f"{int(seed_bits('stickshift'), 2):08X}"  # the same 32 bits
    assert body["confidence"] > 0.8
    # Quiet room, and a loud clap: neither is a registration sound.
    assert inspect(20.0, 22.0).json()["found"] is False
    assert inspect(24.5, 26.0).json()["found"] is False
    # A stretch that long is not a mark of the sound; a recording that isn't there is a 404.
    assert inspect(0.0, 30.0).status_code == 422
    missing = client.get(
        f"/projects/{project}/sync/inspect",
        params={"media_id": "nope", "start_s": 0, "end_s": 1},
    )
    assert missing.status_code == 404

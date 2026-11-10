import numpy as np
import pytest
from fastapi.testclient import TestClient

from tests.conftest import needs_ffmpeg, write_image, write_video, write_wav

pytestmark = needs_ffmpeg


@pytest.fixture
def ids(client: TestClient, library, project):
    audio = np.zeros(10 * 44_100)
    audio[2 * 44_100 : 4 * 44_100] = 0.3 * np.sin(2 * np.pi * 300 * np.arange(2 * 44_100) / 44_100)
    audio[8 * 44_100 :] = 0.3
    write_wav(library / "mic.wav", audio)
    write_video(library / "cam.mp4", seconds=10)
    write_image(library / "car.png")
    return {
        n: client.post(f"/projects/{project}/media", json={"path": n}).json()["id"]
        for n in ("mic.wav", "cam.mp4", "car.png")
    }


def test_edit_defaults_then_saves_and_round_trips(client: TestClient, project, ids):
    initial = client.get(f"/projects/{project}/edit").json()
    assert initial["edit"]["switches"] == [] and initial["needs_upgrade"] is False

    edit = {
        **initial["edit"],
        "switches": [{"at_s": 1.0, "media_id": ids["cam.mp4"]}],
        "cuts": [{"start_s": 4.5, "end_s": 7.5}],
        "stills": [{"id": "s1", "media_id": ids["car.png"], "start_s": 2.0, "end_s": 3.0}],
        "tracks": [{"media_id": ids["mic.wav"], "gain_db": -3.0, "muted": False}],
    }
    saved = client.put(f"/projects/{project}/edit", json=edit)
    assert saved.status_code == 200, saved.text
    assert client.get(f"/projects/{project}/edit").json()["edit"] == saved.json()["edit"]
    assert saved.json()["edit"]["cuts"] == [{"start_s": 4.5, "end_s": 7.5}]


@pytest.mark.parametrize(
    "patch",
    [
        {"switches": [{"at_s": 1, "media_id": "nope"}]},
        {"cuts": [{"start_s": 5, "end_s": 5}]},
        {"stills": [{"id": "s", "media_id": "nope", "start_s": 1, "end_s": 2}]},
        {"range_in_s": 5, "range_out_s": 2},
        {"fps_num": 0},
    ],
)
def test_invalid_edits_are_rejected(client: TestClient, project, ids, patch):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    assert client.put(f"/projects/{project}/edit", json={**base, **patch}).status_code == 422


def test_a_still_must_be_an_image_and_a_switch_a_video(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    wrong_still = {"id": "s", "media_id": ids["mic.wav"], "start_s": 1, "end_s": 2}
    assert (
        client.put(f"/projects/{project}/edit", json={**base, "stills": [wrong_still]}).status_code
        == 422
    )
    wrong_cam = {"at_s": 1, "media_id": ids["car.png"]}
    assert (
        client.put(f"/projects/{project}/edit", json={**base, "switches": [wrong_cam]}).status_code
        == 422
    )


def test_saving_requires_the_token(client: TestClient, project):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    denied = client.put(
        f"/projects/{project}/edit", json=base, headers={"Authorization": "Bearer no"}
    )
    assert denied.status_code == 401


def test_plan_reflects_the_saved_edit(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    edit = {
        **base,
        "cuts": [{"start_s": 4.0, "end_s": 8.0}],
        "stills": [{"id": "s", "media_id": ids["car.png"], "start_s": 1.0, "end_s": 2.0}],
    }
    client.put(f"/projects/{project}/edit", json=edit)
    plan = client.get(f"/projects/{project}/plan").json()
    assert plan["duration_s"] == pytest.approx(6.0, abs=0.1)
    assert [s["kind"] for s in plan["video"]] == ["camera", "still", "camera", "camera"][
        : len(plan["video"])
    ]
    assert plan["audio"] and plan["audio"][0]["media_id"] == ids["mic.wav"]


def test_silence_suggestions_come_from_the_audio_envelope(client: TestClient, project, ids):
    response = client.get(f"/projects/{project}/silence", params={"min_s": 1.5, "pad_s": 0.2})
    assert response.status_code == 200, response.text
    cuts = response.json()["cuts"]
    # Silent 0-2 s and 4-8 s (sound at 2-4 s and 8-10 s).
    assert [(round(c["start_s"], 1), round(c["end_s"], 1)) for c in cuts] == [
        (0.0, 1.8),
        (4.2, 7.8),
    ]

import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.services.jobs import jobs
from edith.sync.registration import padded_wav, registration_burst
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
        "switches": [
            {"at_s": 1.0, "media_id": ids["cam.mp4"]},
            {"at_s": 2.0, "media_id": ids["car.png"]},  # a still is a channel like a camera
            {"at_s": 3.0, "media_id": None},  # back to the default camera
        ],
        "cuts": [{"start_s": 4.5, "end_s": 7.5}],
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
        {"range_in_s": 5, "range_out_s": 2},
        {"fps_num": 0},
    ],
)
def test_invalid_edits_are_rejected(client: TestClient, project, ids, patch):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    assert client.put(f"/projects/{project}/edit", json={**base, **patch}).status_code == 422


def test_a_switch_must_name_a_camera_or_a_still_not_audio(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    for ok in (ids["cam.mp4"], ids["car.png"], None):
        body = {**base, "switches": [{"at_s": 1, "media_id": ok}]}
        assert client.put(f"/projects/{project}/edit", json=body).status_code == 200
    for bad in (ids["mic.wav"], "nope"):
        body = {**base, "switches": [{"at_s": 1, "media_id": bad}]}
        assert client.put(f"/projects/{project}/edit", json=body).status_code == 422


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
        "switches": [
            {"at_s": 1.0, "media_id": ids["car.png"]},
            {"at_s": 2.0, "media_id": ids["cam.mp4"]},
        ],
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


def _beep_session(client: TestClient, library, project, speech_from: float = 8.0, kind="excerpt"):
    """Quiet room, a registration beep at 5 s and 15 s, speech-like noise until 12 s.

    `kind` is how the sound is specified to sync: a marked excerpt, a seed, or an audio file.
    """
    rate = 44_100
    audio = np.random.default_rng(3).normal(0, 0.0003, 22 * rate)
    burst = registration_burst("x") * 0.1
    for t in (5.0, 15.0):
        audio[int(t * rate) : int(t * rate) + len(burst)] += burst
    start = int(speech_from * rate)
    audio[start : 12 * rate] += np.random.default_rng(4).normal(0, 0.1, 12 * rate - start)
    write_wav(library / "mic.wav", audio)
    media_id = client.post(f"/projects/{project}/media", json={"path": "mic.wav"}).json()["id"]
    if kind == "seed":
        template = {"kind": "seed", "seed": "x"}
    elif kind == "file":
        (library / "reference.wav").write_bytes(padded_wav("x"))
        template = {"kind": "file", "path": "reference.wav"}
    else:
        template = {"kind": "excerpt", "media_id": media_id, "start_s": 4.9, "end_s": 5.3}
    job = client.post(f"/projects/{project}/sync", json={"template": template}).json()
    assert jobs.wait(job["id"]).state == "done"


def _cuts(client: TestClient, project):
    response = client.get(f"/projects/{project}/silence", params={"min_s": 1.5, "pad_s": 0.4})
    return [(round(c["start_s"], 2), round(c["end_s"], 2)) for c in response.json()["cuts"]]


def test_registration_sounds_are_cut_with_the_dead_time_around_them(client, library, project):
    _beep_session(client, library, project)
    # Opening: quiet + beep + quiet up to the speech (8 s) less padding; closing: 12.4 s to the end.
    # Without the registration rule the beeps split these into pieces and stay in the edit.
    cuts = _cuts(client, project)
    assert cuts == [pytest.approx((0.0, 7.6), abs=0.05), pytest.approx((12.4, 22.0), abs=0.05)]


def test_a_beep_right_before_speech_is_still_cut_but_the_speech_is_not(client, library, project):
    _beep_session(client, library, project, speech_from=5.7)  # only 0.4 s after the beep ends
    cuts = _cuts(client, project)
    assert cuts[0][0] <= 4.65 and cuts[0][1] >= 5.55  # the beep plus its margin
    assert cuts[0][1] < 5.7  # and none of the speech


def test_mix_regions_save_and_shape_the_plan(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    mix = [
        {"media_id": ids["mic.wav"], "start_s": 2.0, "end_s": 4.0, "gain_db": -9.0, "muted": False}
    ]
    saved = client.put(f"/projects/{project}/edit", json={**base, "mix": mix})
    assert saved.status_code == 200, saved.text
    assert client.get(f"/projects/{project}/edit").json()["edit"]["mix"] == mix
    plan = client.get(f"/projects/{project}/plan").json()
    assert sorted(round(a["gain_db"], 1) for a in plan["audio"]) == [-9.0, 0.0, 0.0]


@pytest.mark.parametrize(
    "region",
    [
        {"media_id": "nope", "start_s": 1, "end_s": 2},
        {"media_id": "IMAGE", "start_s": 1, "end_s": 2},  # an image has no audio
        {"media_id": "MIC", "start_s": 3, "end_s": 3},
    ],
)
def test_invalid_mix_regions_are_rejected(client: TestClient, project, ids, region):
    region = {
        **region,
        "media_id": {"IMAGE": ids["car.png"], "MIC": ids["mic.wav"]}.get(
            region["media_id"], region["media_id"]
        ),
    }
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    assert (
        client.put(f"/projects/{project}/edit", json={**base, "mix": [region]}).status_code == 422
    )


def test_removing_media_removes_its_mix_regions(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    mix = [{"media_id": ids["mic.wav"], "start_s": 1.0, "end_s": 2.0, "muted": True}]
    client.put(f"/projects/{project}/edit", json={**base, "mix": mix})
    assert client.delete(f"/projects/{project}/media/{ids['mic.wav']}").status_code == 204
    assert client.get(f"/projects/{project}/edit").json()["edit"]["mix"] == []


@pytest.mark.parametrize("kind", ["excerpt", "seed", "file"])
def test_registration_sounds_are_cut_whichever_way_the_sound_was_specified(
    client, library, project, kind
):
    # Regression: dead-time detection returned a 500 unless the sound was marked in a recording.
    _beep_session(client, library, project, kind=kind)
    cuts = _cuts(client, project)
    assert cuts == [pytest.approx((0.0, 7.6), abs=0.05), pytest.approx((12.4, 22.0), abs=0.05)]


def test_disabled_assets_are_saved_but_never_change_the_output(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    before = client.get(f"/projects/{project}/plan").json()

    disabled = [ids["cam.mp4"], ids["car.png"]]
    saved = client.put(f"/projects/{project}/edit", json={**base, "disabled": disabled})
    assert saved.status_code == 200, saved.text
    assert client.get(f"/projects/{project}/edit").json()["edit"]["disabled"] == disabled
    # A working-set setting: the plan (what gets exported and rendered) is identical.
    assert client.get(f"/projects/{project}/plan").json() == before


@pytest.mark.parametrize("which", ["MIC", "nope"])
def test_only_cameras_and_stills_can_be_disabled(client: TestClient, project, ids, which):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    target = ids["mic.wav"] if which == "MIC" else "nope"  # audio has its own toggle
    response = client.put(f"/projects/{project}/edit", json={**base, "disabled": [target]})
    assert response.status_code == 422, response.text


def test_removing_media_removes_it_from_the_disabled_list(client: TestClient, project, ids):
    base = client.get(f"/projects/{project}/edit").json()["edit"]
    client.put(f"/projects/{project}/edit", json={**base, "disabled": [ids["cam.mp4"]]})
    assert client.delete(f"/projects/{project}/media/{ids['cam.mp4']}").status_code == 204
    assert client.get(f"/projects/{project}/edit").json()["edit"]["disabled"] == []

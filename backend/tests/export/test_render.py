from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.core.errors import MediaError
from edith.db.documents import MediaItem
from edith.edit.plan import AudioSeg, RenderPlan, VideoSeg
from edith.export.render import build_command
from edith.services.jobs import jobs
from edith.sync import media as probing
from tests.conftest import needs_ffmpeg, write_image, write_video, write_wav

MEDIA = {
    "cam": MediaItem(
        id="cam", path="cam.mp4", kind="video", label="cam.mp4", duration_s=60, has_audio=True
    ),
    "mic": MediaItem(
        id="mic", path="mic.wav", kind="audio", label="mic.wav", duration_s=60, has_audio=True
    ),
    "car": MediaItem(id="car", path="car.png", kind="image", label="car.png"),
}


def plan(**kw) -> RenderPlan:
    base = dict(
        duration_s=10.0,
        video=[VideoSeg("cam", "camera", 0, 6, 12.5), VideoSeg("car", "still", 6, 4, 0)],
        audio=[AudioSeg("mic", 0, 10, 3.0, -6.0)],
        fps_num=30000, fps_den=1001, width=1920, height=1080,
    )  # fmt: skip
    return RenderPlan(**{**base, **kw})


def command(p: RenderPlan):
    return build_command(p, MEDIA, lambda item: Path("/m") / item.path, Path("/out.mp4"))


def test_each_clip_is_a_seeked_input_in_order():
    args = command(plan()).args
    inputs = [args[i + 1] for i, a in enumerate(args) if a == "-i"]
    assert inputs == ["/m/cam.mp4", "/m/car.png", "/m/mic.wav"]
    assert args[args.index("-ss") + 1] == "12.500000"  # camera source in
    assert "-loop" not in args  # a looped input stalls ffmpeg inside the concat on real footage


def test_filtergraph_scales_concatenates_and_mixes_with_gain_and_delay():
    graph = command(plan(audio=[AudioSeg("mic", 2.5, 5, 3.0, -6.0)])).args
    graph = graph[graph.index("-filter_complex") + 1]
    assert "scale=1920:1080:force_original_aspect_ratio=decrease" in graph
    assert "fps=30000/1001" in graph and "concat=n=2:v=1:a=0[vout]" in graph
    assert "volume=-6dB" in graph and "adelay=2500|2500" in graph
    assert "loop=loop=" in graph  # the still is held by a filter


def test_no_audio_means_no_audio_mapping():
    args = command(plan(audio=[])).args
    assert "[aout]" not in " ".join(args) and "-c:a" not in args


def test_an_edit_without_video_cannot_render():
    with pytest.raises(MediaError):
        command(plan(video=[]))


@needs_ffmpeg
def test_renders_a_real_edit_to_1080p_with_audio(client: TestClient, library, project):
    write_video(library / "cam.mp4", seconds=8)
    write_wav(library / "mic.wav", 0.2 * np.sin(2 * np.pi * 330 * np.arange(8 * 44_100) / 44_100))
    write_image(library / "car.jpg", "800x400")
    ids = {n: client.post(f"/projects/{project}/media", json={"path": n}).json()["id"]
           for n in ("cam.mp4", "mic.wav", "car.jpg")}  # fmt: skip
    edit = client.get(f"/projects/{project}/edit").json()["edit"]
    edit["cuts"] = [{"start_s": 2.0, "end_s": 3.0}]
    edit["switches"] = [
        {"at_s": 4.0, "media_id": ids["car.jpg"]},
        {"at_s": 5.0, "media_id": ids["cam.mp4"]},
    ]
    edit["tracks"] = [{"media_id": ids["mic.wav"], "gain_db": -6.0, "muted": False}]
    assert client.put(f"/projects/{project}/edit", json=edit).status_code == 200

    job = client.post(f"/projects/{project}/render")
    assert job.status_code == 202, job.text
    done = jobs.wait(job.json()["id"], timeout=120)
    assert done.state == "done", done.error

    listed = client.get(f"/projects/{project}/renders").json()
    assert (
        len(listed) == 1 and listed[0]["name"] == done.result["name"] and listed[0]["size"] > 5_000
    )
    path = library / project / "renders" / listed[0]["name"]
    info = probing.probe(path)
    assert (info.width, info.height) == (1920, 1080) and info.has_audio
    assert info.duration_s == pytest.approx(7.0, abs=0.25)  # 8 s minus the 1 s cut
    assert info.fps == pytest.approx(29.97, abs=0.05)

    download = client.get(f"/projects/{project}/renders/{listed[0]['name']}")
    assert download.status_code == 200 and download.headers["content-type"] == "video/mp4"
    assert client.get(f"/projects/{project}/renders/..%2Fproject.edith").status_code == 404
    assert not list((library / project / "renders").glob("*.partial*"))


@needs_ffmpeg
def test_a_failed_render_leaves_no_partial_file(client: TestClient, library, project):
    write_wav(library / "mic.wav", np.zeros(44_100))
    client.post(f"/projects/{project}/media", json={"path": "mic.wav"})
    done = jobs.wait(client.post(f"/projects/{project}/render").json()["id"])
    assert done.state == "error" and "nothing to render" in done.error
    assert client.get(f"/projects/{project}/renders").json() == []


def test_render_requires_the_token(client: TestClient, project):
    denied = client.post(f"/projects/{project}/render", headers={"Authorization": "Bearer no"})
    assert denied.status_code == 401

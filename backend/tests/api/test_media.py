import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.services.jobs import jobs
from tests.conftest import needs_ffmpeg, settled, write_image, write_video, write_wav

pytestmark = needs_ffmpeg


def test_each_kind_of_media_is_found_in_the_folder_and_can_be_included(
    client: TestClient, project_dir, project
):
    settled(write_wav(project_dir / "media" / "mic.wav", np.zeros(44_100)))
    settled(write_video(project_dir / "media" / "cam.mp4"))
    settled(write_image(project_dir / "media" / "car.png"))
    (project_dir / "media" / "notes.txt").write_text("not media")

    found = {m["label"]: m["kind"] for m in client.get(f"/projects/{project}/media").json()}
    assert found == {"cam.mp4": "video", "car.png": "image", "mic.wav": "audio"}  # notes.txt isn't

    added = {}
    for name in ("mic.wav", "cam.mp4", "car.png"):
        response = client.post(f"/projects/{project}/media", json={"path": f"media/{name}"})
        assert response.status_code == 201, response.text
        added[name] = response.json()
    assert added["cam.mp4"]["kind"] == "video" and added["cam.mp4"]["width"] == 320
    assert added["cam.mp4"]["fps"] == pytest.approx(30, abs=0.1) and added["cam.mp4"]["has_audio"]
    assert added["mic.wav"]["kind"] == "audio" and added["mic.wav"]["duration_s"] == pytest.approx(
        1.0, abs=0.05
    )
    assert added["car.png"]["kind"] == "image" and added["car.png"]["duration_s"] is None

    listed = client.get(f"/projects/{project}/media").json()
    assert sorted(m["label"] for m in listed) == ["cam.mp4", "car.png", "mic.wav"]
    again = client.post(f"/projects/{project}/media", json={"path": "media/mic.wav"})
    assert again.json()["id"] == added["mic.wav"]["id"]
    assert len(client.get(f"/projects/{project}/media").json()) == 3


@pytest.mark.parametrize("bad", ["/etc/passwd", "../outside.wav", "media/../../x.wav"])
def test_unsafe_or_missing_paths_are_rejected(client: TestClient, project, bad):
    response = client.post(f"/projects/{project}/media", json={"path": bad})
    assert response.status_code == 422, response.text


def test_adding_a_file_that_does_not_exist_is_a_404_that_names_it(client: TestClient, project):
    response = client.post(f"/projects/{project}/media", json={"path": "missing.wav"})
    assert response.status_code == 404
    assert response.json()["message"] == "Can't read missing.wav"


def test_adding_media_requires_the_token(client: TestClient, project_dir, project):
    write_wav(project_dir / "a.wav", np.zeros(4_410))
    denied = client.post(
        f"/projects/{project}/media", json={"path": "a.wav"}, headers={"Authorization": "Bearer no"}
    )
    assert denied.status_code == 401


def test_proxies_build_in_a_job_and_are_served(client: TestClient, project_dir, project):
    write_video(project_dir / "cam.mp4")
    write_wav(project_dir / "mic.wav", np.zeros(44_100))
    write_image(project_dir / "car.png", "1920x1080")
    for name in ("cam.mp4", "mic.wav", "car.png"):
        client.post(f"/projects/{project}/media", json={"path": name})

    job = client.post(f"/projects/{project}/proxies").json()
    assert job["state"] in ("running", "done")
    done = jobs.wait(job["id"])
    assert done.state == "done", done.error

    media = client.get(f"/projects/{project}/media").json()
    assert all(m["proxy_ready"] for m in media)
    video = next(m for m in media if m["kind"] == "video")
    response = client.get(f"/projects/{project}/media/{video['id']}/proxy")
    assert response.status_code == 200 and response.headers["content-type"] == "video/mp4"
    assert len(response.content) > 1000
    ranged = client.get(
        f"/projects/{project}/media/{video['id']}/proxy", headers={"Range": "bytes=0-99"}
    )
    assert ranged.status_code == 206 and len(ranged.content) == 100
    # Only missing proxies are rebuilt.
    again = jobs.wait(client.post(f"/projects/{project}/proxies").json()["id"])
    assert again.result == {"built": 0}
    assert client.get("/jobs/nope").status_code == 404


def test_peaks_reflect_loudness_and_are_cached(client: TestClient, project_dir, project):
    audio = np.zeros(3 * 44_100)
    audio[44_100 : 2 * 44_100] = 0.5 * np.sin(2 * np.pi * 440 * np.arange(44_100) / 44_100)
    write_wav(project_dir / "mic.wav", audio)
    media_id = client.post(f"/projects/{project}/media", json={"path": "mic.wav"}).json()["id"]

    peaks = client.get(f"/projects/{project}/media/{media_id}/peaks").json()
    values = np.array(peaks["values"])
    assert peaks["rate"] == 100 and len(values) == pytest.approx(300, abs=2)
    assert values[:80].max() == 0 and values[120:180].min() > 200 and values[220:].max() == 0
    assert (project_dir / ".edith" / "peaks" / f"{media_id}.json").is_file()
    assert client.get(f"/projects/{project}/media/{media_id}/peaks").json() == peaks


def test_thumbnails_for_video_and_images_but_not_audio(client: TestClient, project_dir, project):
    write_video(project_dir / "cam.mp4", seconds=4)
    write_image(project_dir / "car.jpg", "1200x800")
    write_wav(project_dir / "mic.wav", np.zeros(4_410))
    ids = {
        n: client.post(f"/projects/{project}/media", json={"path": n}).json()["id"]
        for n in ("cam.mp4", "car.jpg", "mic.wav")
    }
    for name in ("cam.mp4", "car.jpg"):
        response = client.get(f"/projects/{project}/media/{ids[name]}/thumb")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "image/jpeg"
        assert response.content[:2] == b"\xff\xd8"  # a real JPEG
        assert (project_dir / ".edith" / "thumbs-144" / f"{ids[name]}.jpg").is_file()
    assert client.get(f"/projects/{project}/media/{ids['mic.wav']}/thumb").status_code == 404
    assert client.get(f"/projects/{project}/media/nope/thumb").status_code == 404


def test_missing_media_is_a_404_that_names_the_file(client: TestClient, project_dir, project):
    """Both a moved file and an unplugged drive (a dangling link) say which file can't be read."""
    write_wav(project_dir / "media" / "mic.wav", np.zeros(44_100))
    item = client.post(f"/projects/{project}/media", json={"path": "media/mic.wav"}).json()
    peaks = f"/projects/{project}/media/{item['id']}/peaks"

    (project_dir / "media" / "mic.wav").unlink()
    assert client.get(peaks).status_code == 404
    assert client.get(peaks).json()["message"] == "Can't read media/mic.wav"

    (project_dir / "media").rmdir()
    (project_dir / "media").symlink_to(
        project_dir / "unplugged-drive"
    )  # a link whose target is gone
    assert client.get(peaks).json()["message"] == "Can't read media/mic.wav"

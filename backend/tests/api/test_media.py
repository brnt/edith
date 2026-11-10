import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.services import autoproxy, media_items
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


def test_proxies_are_built_for_detected_media_and_served(client: TestClient, project_dir, project):
    settled(write_video(project_dir / "cam.mp4"))
    settled(write_wav(project_dir / "mic.wav", np.zeros(44_100)))
    settled(write_image(project_dir / "car.png", "1920x1080"))
    client.post(
        f"/projects/{project}/media", json={"path": "cam.mp4"}
    )  # one included, two just found
    assert not any(m["proxy_ready"] for m in client.get(f"/projects/{project}/media").json())

    assert autoproxy.build_pending(project) == 3  # all of them: nobody has to ask
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
    assert autoproxy.build_pending(project) == 0  # only what is missing is ever built
    assert client.get("/jobs/nope").status_code == 404


def test_the_media_list_starts_the_builder_and_says_what_is_waiting(
    client: TestClient, project_dir, project, monkeypatch
):
    from edith.core.config import get_settings

    monkeypatch.setenv("AUTO_PROXIES", "true")
    get_settings.cache_clear()
    started: list[object] = []
    monkeypatch.setattr(autoproxy, "_spawn", started.append)  # record, don't run a thread
    settled(write_video(project_dir / "cam.mp4"))
    listed = client.get(f"/projects/{project}/media").json()
    assert [m["proxy_building"] for m in listed] == [True] and len(started) == 1
    client.get(f"/projects/{project}/media")  # a worker is already queued for this folder
    assert len(started) == 1
    started[0]()  # the worker runs...
    after = client.get(f"/projects/{project}/media").json()
    assert after[0]["proxy_ready"] is True and after[0]["proxy_building"] is False


def test_the_project_own_media_is_made_first_and_a_broken_file_is_skipped(
    client: TestClient, project_dir, project
):
    settled(write_video(project_dir / "a-found.mp4"))
    settled(write_video(project_dir / "z-included.mp4"))
    (project_dir / "broken.mp4").write_bytes(b"not a video")
    settled(project_dir / "broken.mp4")
    client.post(f"/projects/{project}/media", json={"path": "z-included.mp4"})
    records = media_items.list_media(project, with_available=True)
    order = [r.item.label for r in autoproxy.needed(str(project_dir), records)]
    assert order[0] == "z-included.mp4"  # included first, then what was just found
    assert autoproxy.build_pending(project) == 2  # the broken file is skipped, not retried
    assert (
        autoproxy.needed(str(project_dir), media_items.list_media(project, with_available=True))
        == []
    )


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


def test_a_still_gets_its_proxy_the_first_time_it_is_wanted_but_a_video_does_not(
    client: TestClient, project_dir, project
):
    settled(write_image(project_dir / "car.png"))
    settled(write_video(project_dir / "cam.mp4"))
    ids = {}
    for name in ("car.png", "cam.mp4"):
        ids[name] = client.post(f"/projects/{project}/media", json={"path": name}).json()["id"]
    listed = {m["label"]: m for m in client.get(f"/projects/{project}/media").json()}
    assert listed["car.png"]["proxy_ready"] is False  # nobody pressed Build proxies

    served = client.get(f"/projects/{project}/media/{ids['car.png']}/proxy")
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert (project_dir / ".edith" / "proxy" / f"{ids['car.png']}.jpg").is_file()
    # A video proxy takes real work, so it still waits for Build proxies.
    assert client.get(f"/projects/{project}/media/{ids['cam.mp4']}/proxy").status_code == 404

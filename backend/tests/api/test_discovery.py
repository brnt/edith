import hashlib
import os
import time
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from tests.conftest import needs_ffmpeg, write_image, write_video, write_wav

pytestmark = needs_ffmpeg


def _age(path: Path, seconds: float = 60) -> Path:
    """Make a file look old enough that it is not still being copied."""
    past = time.time() - seconds
    os.utime(path, (past, past))
    return path


def _media(client: TestClient, project: str) -> dict[str, dict]:
    listed = client.get(f"/projects/{project}/media").json()
    return {m["label"]: m for m in listed}


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_files_in_the_project_folder_are_available_but_not_part_of_the_project(
    client: TestClient, library: Path, project: str
):
    folder = library / project
    _age(write_wav(folder / "mic.wav", np.zeros(44_100)))
    _age(write_video(folder / "cam.mp4"))
    _age(write_image(folder / "car.png"))

    media = _media(client, project)
    assert set(media) == {"mic.wav", "cam.mp4", "car.png"}
    assert {m["included"] for m in media.values()} == {False}
    assert media["cam.mp4"]["kind"] == "video" and media["cam.mp4"]["width"] == 320
    assert media["cam.mp4"]["folder"] == "" and media["cam.mp4"]["external"] is False
    assert media["mic.wav"]["size_bytes"] > 0


def test_looking_never_writes_the_project_file(client: TestClient, library: Path, project: str):
    _age(write_video(library / project / "cam.mp4"))
    project_file = library / project / "project.edith"
    before = _digest(project_file)
    for _ in range(3):
        client.get(f"/projects/{project}/media")
        client.get(f"/projects/{project}/media/{_media(client, project)['cam.mp4']['id']}/thumb")
    assert _digest(project_file) == before


def test_including_a_found_file_is_the_edit_that_writes_it(
    client: TestClient, library: Path, project: str
):
    _age(write_video(library / project / "cam.mp4"))
    found = _media(client, project)["cam.mp4"]
    added = client.post(f"/projects/{project}/media", json={"path": found["path"]})
    assert added.status_code == 201
    assert added.json()["id"] == found["id"]  # the same id, so nothing on screen changes identity
    now = _media(client, project)
    assert list(now) == ["cam.mp4"] and now["cam.mp4"]["included"] is True


def test_subfolders_are_found_and_report_their_folder(
    client: TestClient, library: Path, project: str
):
    _age(write_video(library / project / "day1" / "camA" / "a.mp4"))
    _age(write_video(library / project / "b.mp4"))
    media = _media(client, project)
    assert media["a.mp4"]["folder"] == "day1/camA"
    assert media["b.mp4"]["folder"] == ""


def test_a_file_still_being_copied_waits_until_it_settles(
    client: TestClient, library: Path, project: str
):
    write_video(library / project / "new.mp4")  # modified just now
    assert _media(client, project) == {}
    _age(library / project / "new.mp4")
    assert set(_media(client, project)) == {"new.mp4"}


def test_derived_and_hidden_files_are_not_media(client: TestClient, library: Path, project: str):
    folder = library / project
    _age(write_video(folder / "renders" / "show.mp4"))  # a render of this project
    _age(write_video(folder / "cache" / "proxy" / "x.mp4"))
    _age(write_video(folder / ".hidden.mp4"))
    _age(write_video(folder / "keep.mp4"))
    (folder / "download.mp4.part").write_bytes(b"partial")
    (folder / "notes.txt").write_text("not media")
    assert set(_media(client, project)) == {"keep.mp4"}


def test_linked_footage_is_followed(client: TestClient, library: Path, project: str, tmp_path):
    outside = library / "ssd"
    _age(write_video(outside / "gopro.mp4"))
    (library / project / "footage").symlink_to(outside)
    media = _media(client, project)
    assert "gopro.mp4" in media and media["gopro.mp4"]["folder"] == "footage"


def test_a_project_media_file_that_vanishes_is_marked_missing_not_dropped(
    client: TestClient, library: Path, project: str
):
    _age(write_wav(library / project / "mic.wav", np.zeros(44_100)))
    found = _media(client, project)["mic.wav"]
    client.post(f"/projects/{project}/media", json={"path": found["path"]})
    (library / project / "mic.wav").unlink()
    media = _media(client, project)
    assert media["mic.wav"]["included"] is True and media["mic.wav"]["missing"] is True


def test_media_outside_the_project_folder_is_external(
    client: TestClient, library: Path, project: str
):
    write_video(library / "shared" / "cam.mp4")
    client.post(f"/projects/{project}/media", json={"path": "shared/cam.mp4"})
    item = _media(client, project)["cam.mp4"]
    assert item["external"] is True and item["folder"] == "shared"


def test_details_describe_the_streams(client: TestClient, library: Path, project: str):
    _age(write_video(library / project / "cam.mp4"))
    found = _media(client, project)["cam.mp4"]
    d = client.get(f"/projects/{project}/media/{found['id']}/details").json()
    assert d["video"]["width"] == 320 and d["video"]["codec"] == "h264"
    assert d["video"]["bit_depth"] == 8 and d["video"]["fps_variable"] is False
    assert d["audio"]["sample_rate"] == 48000 and d["audio"]["channels"] == 1
    assert d["size_bytes"] > 0 and d["container"]


def test_proxies_are_only_built_for_included_media(client: TestClient, library: Path, project: str):
    _age(write_video(library / project / "cam.mp4"))
    started = client.post(f"/projects/{project}/proxies")
    assert started.status_code == 202  # nothing included: nothing to build, and no error


def test_relinking_a_missing_file_carries_every_reference_to_the_new_one(
    client: TestClient, library: Path, project: str
):
    _age(write_video(library / "old" / "cam.mp4"))
    _age(write_video(library / "new" / "cam.mp4"))
    old = client.post(f"/projects/{project}/media", json={"path": "old/cam.mp4"}).json()
    other = client.post(f"/projects/{project}/media", json={"path": "new/cam.mp4"}).json()
    client.delete(f"/projects/{project}/media/{other['id']}")  # only the old one is in the project
    client.put(
        f"/projects/{project}/edit",
        json={
            "switches": [{"at_s": 5, "media_id": old["id"]}],
            "tracks": [{"media_id": old["id"], "gain_db": -3, "muted": False}],
            "mix": [{"media_id": old["id"], "start_s": 1, "end_s": 2, "gain_db": 0, "muted": True}],
            "disabled": [old["id"]],
        },
    )
    (library / "old" / "cam.mp4").unlink()  # the drive went away
    assert _media(client, project)["cam.mp4"]["missing"] is True

    moved = client.post(
        f"/projects/{project}/media/{old['id']}/relink", json={"path": "new/cam.mp4"}
    )
    assert moved.status_code == 200, moved.text
    new_id = moved.json()["id"]
    assert new_id != old["id"] and moved.json()["missing"] is False
    listed = client.get(f"/projects/{project}/media").json()
    assert [m["id"] for m in listed if m["included"]] == [new_id]  # the old one is gone
    edit = client.get(f"/projects/{project}/edit").json()["edit"]
    assert edit["switches"] == [{"at_s": 5, "media_id": new_id}]
    assert edit["tracks"][0]["media_id"] == new_id and edit["mix"][0]["media_id"] == new_id
    assert edit["disabled"] == [new_id]


def test_relinking_to_a_different_kind_of_file_is_refused(
    client: TestClient, library: Path, project: str
):
    write_video(library / "m" / "cam.mp4")
    write_wav(library / "m" / "mic.wav", np.zeros(44_100))
    cam = client.post(f"/projects/{project}/media", json={"path": "m/cam.mp4"}).json()
    refused = client.post(
        f"/projects/{project}/media/{cam['id']}/relink", json={"path": "m/mic.wav"}
    )
    assert refused.status_code == 422 and "audio media" in refused.json()["message"]


def test_a_still_is_described_by_its_image_format_and_a_wrong_extension_is_noticed(
    client: TestClient, library: Path, project: str
):
    honest = _age(write_image(library / project / "honest.png"))
    liar = library / project / "liar.jpg"  # a PNG with a JPEG's name
    liar.write_bytes(honest.read_bytes())
    _age(liar)
    media = _media(client, project)
    d_ok = client.get(f"/projects/{project}/media/{media['honest.png']['id']}/details").json()
    d_bad = client.get(f"/projects/{project}/media/{media['liar.jpg']['id']}/details").json()
    assert d_ok["image_format"] == "PNG" and d_ok["image_extension_matches"] is True
    assert d_bad["image_format"] == "PNG" and d_bad["image_extension_matches"] is False
    video = _age(write_video(library / project / "cam.mp4"))
    cam = _media(client, project)["cam.mp4"]
    assert (
        client.get(f"/projects/{project}/media/{cam['id']}/details").json()["image_format"] is None
    )
    assert video.exists()


def test_folders_the_projects_media_comes_from_are_watched_too(
    client: TestClient, library: Path, project: str
):
    """The shared media/ folder: add one file from it, and what lands there next shows up."""
    _age(write_video(library / "shared" / "first.mp4"))
    client.post(f"/projects/{project}/media", json={"path": "shared/first.mp4"})
    assert set(_media(client, project)) == {"first.mp4"}

    _age(write_image(library / "shared" / "new.png"))  # dropped into the folder afterwards
    _age(write_image(library / "shared" / "deeper" / "other.png"))  # one level only
    _age(write_image(library / "elsewhere" / "unrelated.png"))  # not a folder the project uses
    media = _media(client, project)
    assert set(media) == {"first.mp4", "new.png"}
    assert media["new.png"]["included"] is False and media["new.png"]["external"] is True
    assert media["new.png"]["folder"] == "shared"

    # Looking still never writes the project file.
    before = _digest(library / project / "project.edith")
    client.get(f"/projects/{project}/media")
    assert _digest(library / project / "project.edith") == before
    # And it can be included like any other found file.
    added = client.post(f"/projects/{project}/media", json={"path": media["new.png"]["path"]})
    assert added.status_code == 201

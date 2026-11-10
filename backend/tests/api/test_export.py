import json
import xml.etree.ElementTree as ET

import numpy as np
import pytest
from fastapi.testclient import TestClient

from tests.conftest import needs_ffmpeg, write_image, write_video, write_wav

pytestmark = needs_ffmpeg


@pytest.fixture
def edited(client: TestClient, library, project):
    write_wav(library / "media" / "mic.wav", np.zeros(10 * 44_100))
    write_video(library / "media" / "cam.mp4", seconds=10)
    write_image(library / "media" / "car.png")
    ids = {
        n: client.post(f"/projects/{project}/media", json={"path": f"media/{n}"}).json()["id"]
        for n in ("mic.wav", "cam.mp4", "car.png")
    }
    edit = client.get(f"/projects/{project}/edit").json()["edit"]
    edit["cuts"] = [{"start_s": 3.0, "end_s": 5.0}]
    edit["switches"] = [
        {"at_s": 6.0, "media_id": ids["car.png"]},
        {"at_s": 7.0, "media_id": ids["cam.mp4"]},
    ]
    assert client.put(f"/projects/{project}/edit", json=edit).status_code == 200
    return ids


@pytest.mark.parametrize(
    "fmt,ext", [("json", "json"), ("fcpxml", "fcpxml"), ("xmeml", "xml"), ("edl", "edl")]
)
def test_every_format_downloads(client: TestClient, project, edited, fmt, ext):
    response = client.get(f"/projects/{project}/export/{fmt}")
    assert response.status_code == 200, response.text
    assert f'filename="{project}.{ext}"' in response.headers["content-disposition"]
    assert len(response.text) > 100


def test_xml_exports_parse_and_use_host_paths(
    client: TestClient, project, edited, monkeypatch, library
):
    from edith.core.config import get_settings

    monkeypatch.setenv("HOST_LIBRARY_DIR", "/Volumes/BRENTexp")
    get_settings.cache_clear()
    for fmt in ("fcpxml", "xmeml"):
        text = client.get(f"/projects/{project}/export/{fmt}").text
        ET.fromstring(text.split("\n", 2)[2])
        assert "file://localhost/Volumes/BRENTexp/media/" in text


def test_json_export_contains_every_document_with_its_version(client: TestClient, project, edited):
    bundle = json.loads(client.get(f"/projects/{project}/export/json").text)
    kinds = sorted({d["kind"] for d in bundle["documents"]})
    assert kinds == ["edit", "media", "project_info"]
    expected = {"edit": 2}  # every other kind is still at v1
    assert all(d["schema_version"] == expected.get(d["kind"], 1) for d in bundle["documents"])


def test_unknown_format_is_rejected(client: TestClient, project):
    assert client.get(f"/projects/{project}/export/pdf").status_code == 422

import json
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

import pytest

from edith.db.documents import MediaItem
from edith.edit.plan import AudioSeg, RenderPlan, VideoSeg
from edith.export.common import ExportInput, timecode
from edith.export.edl import to_edl
from edith.export.fcpxml import to_fcpxml
from edith.export.xmeml import to_xmeml

MEDIA = {
    "camA": MediaItem(
        id="camA",
        path="media/Cam A.mp4",
        kind="video",
        label="Cam A.mp4",
        duration_s=60.0,
        width=3840,
        height=2160,
        fps=59.94,
        has_audio=True,
    ),
    "camB": MediaItem(
        id="camB",
        path="media/camB.mp4",
        kind="video",
        label="camB.mp4",
        duration_s=60.0,
        width=3840,
        height=2160,
        fps=29.97,
        has_audio=True,
    ),
    "mic": MediaItem(
        id="mic",
        path="media/mic.wav",
        kind="audio",
        label="mic.wav",
        duration_s=70.0,
        has_audio=True,
    ),
    "car": MediaItem(
        id="car", path="media/car.png", kind="image", label="car.png", width=1000, height=500
    ),
}

PLAN = RenderPlan(
    duration_s=20.0,
    video=[
        VideoSeg("camA", "camera", 0.0, 8.0, 5.0),
        VideoSeg("car", "still", 8.0, 2.0, 0.0),
        VideoSeg("camB", "camera", 10.0, 10.0, 12.5),
    ],
    audio=[AudioSeg("mic", 0.0, 20.0, 3.0, -3.0)],
    fps_num=30000,
    fps_den=1001,
    width=1920,
    height=1080,
)


@pytest.fixture
def data() -> ExportInput:
    return ExportInput("Ep 1", PLAN, MEDIA, lambda item: Path("/Volumes/SSD") / item.path)


def test_timecode():
    assert timecode(0, 30) == "00:00:00:00"
    assert timecode(30 * 3600 + 30 * 61 + 5, 30) == "01:01:01:05"  # 1 h, 1 min, 1 s, 5 f


def test_frames_snap_without_gaps_or_overlaps(data: ExportInput):
    clips = data.video_clips()
    assert [(c.rec_in, c.dur) for c in clips] == [(0, 240), (240, 60), (300, 299)]
    assert all(a.rec_out == b.rec_in for a, b in zip(clips, clips[1:], strict=False))
    assert data.total_frames == 599  # 20 s at 29.97 fps


def test_edl_lists_each_video_clip_with_source_and_record_times(data: ExportInput):
    edl = to_edl(data)
    lines = [ln for ln in edl.splitlines() if ln[:3].isdigit()]
    assert len(lines) == 3
    # reel, track, cut, then source in/out and record in/out (5 s = frame 150 at timebase 30)
    assert lines[0].split()[1:3] == ["CAMA", "V"]
    assert lines[0].split()[-4:] == ["00:00:05:00", "00:00:13:00", "00:00:00:00", "00:00:08:00"]
    assert "FROM CLIP NAME: Cam A.mp4" in edl and "FCM: NON-DROP FRAME" in edl


def _ref_ids(root: ET.Element) -> set[str]:
    return {e.get("id") for e in root.iter() if e.get("id")}


def test_fcpxml_is_well_formed_and_every_reference_resolves(data: ExportInput):
    root = ET.fromstring(to_fcpxml(data).split("\n", 2)[2])
    assert root.tag == "fcpxml" and root.get("version") == "1.9"
    ids = _ref_ids(root)
    clips = list(root.iter("asset-clip")) + list(root.iter("video"))
    assert len(clips) == 4
    assert all(c.get("ref") in ids for c in clips)
    assert all(a.get("format") in ids for a in root.iter("asset") if a.get("format"))
    assert all(
        a.get("src").startswith("file://localhost/Volumes/SSD/media/") for a in root.iter("asset")
    )
    assert "Cam%20A.mp4" in to_fcpxml(data)


def test_fcpxml_times_are_frame_exact_rationals(data: ExportInput):
    root = ET.fromstring(to_fcpxml(data).split("\n", 2)[2])
    gap = root.find(".//gap")
    seconds = lambda s: Fraction(s[:-1]) if "/" in s or s[:-1].isdigit() else Fraction(0)  # noqa: E731
    assert seconds(gap.get("duration")) == Fraction(599 * 1001, 30000)
    first = next(c for c in gap if c.get("name") == "Cam A.mp4")
    assert seconds(first.get("offset")) == 0
    assert seconds(first.get("start")) == Fraction(150 * 1001, 30000)  # 5 s -> frame 150
    assert first.get("lane") == "1"


def test_fcpxml_mutes_camera_audio_and_applies_track_gain(data: ExportInput):
    root = ET.fromstring(to_fcpxml(data).split("\n", 2)[2])
    cam = next(c for c in root.iter("asset-clip") if c.get("name") == "Cam A.mp4")
    assert cam.find("adjust-volume").get("amount") == "-96dB"
    mic = next(c for c in root.iter("asset-clip") if c.get("name") == "mic.wav")
    assert mic.get("lane") == "-1" and mic.find("adjust-volume").get("amount") == "-3dB"


def test_xmeml_structure_and_file_definitions(data: ExportInput):
    root = ET.fromstring(to_xmeml(data).split("\n", 2)[2])
    seq = root.find("sequence")
    assert seq.find("duration").text == "599" and seq.find("rate/timebase").text == "30"
    assert seq.find("rate/ntsc").text == "TRUE"
    video = seq.findall("media/video/track/clipitem")
    assert [(v.find("start").text, v.find("end").text) for v in video] == [
        ("0", "240"),
        ("240", "300"),
        ("300", "599"),
    ]
    assert [(v.find("in").text, v.find("out").text) for v in video][0] == ("150", "390")
    audio = seq.findall("media/audio/track/clipitem")
    assert (
        len(audio) == 1
        and audio[0].find("filter/effect/parameter/value").text == f"{10 ** (-3 / 20):.4f}"
    )
    # Each file is fully described once; later references are bare.
    files = [f for f in root.iter("file")]
    described = [f for f in files if f.find("pathurl") is not None]
    assert len({f.get("id") for f in files}) == len(described) == 4
    assert described[0].find("pathurl").text == "file://localhost/Volumes/SSD/media/Cam%20A.mp4"


def test_the_exports_agree_on_the_edit(data: ExportInput):
    fcp = ET.fromstring(to_fcpxml(data).split("\n", 2)[2])
    xml = ET.fromstring(to_xmeml(data).split("\n", 2)[2])
    assert len(list(fcp.iter("asset-clip"))) + len(list(fcp.iter("video"))) == len(
        xml.findall(".//clipitem")
    )


def test_json_bundle_round_trips_stored_documents():
    from edith.export.bundle import FORMAT, to_bundle

    class FakeProject:
        def dump_documents(self):
            return [{"kind": "media", "id": "x", "schema_version": 1, "body": {"a": 1}}]

    bundle = json.loads(to_bundle("ep1", FakeProject()))
    assert bundle["format"] == FORMAT and bundle["project"] == "ep1"
    assert bundle["documents"][0]["schema_version"] == 1

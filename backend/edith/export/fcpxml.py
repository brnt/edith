"""FCPXML 1.9 (DaVinci Resolve, Final Cut Pro).

The sequence is one gap holding every clip as a connected clip: video on lane 1, each audio
track on its own negative lane. On-camera audio is muted; track gain becomes a volume
adjustment. Assets use the 1.9 `src` attribute.
"""

import xml.etree.ElementTree as ET
from fractions import Fraction

from edith.db.documents import MediaItem
from edith.export.common import Clip, ExportInput


def _t(seconds: Fraction | float) -> str:
    f = Fraction(seconds).limit_denominator(1000000)
    return f"{f.numerator}/{f.denominator}s" if f.denominator != 1 else f"{f.numerator}s"


def _frames_t(data: ExportInput, frames: int) -> str:
    return _t(Fraction(frames * data.plan.fps_den, data.plan.fps_num))


def to_fcpxml(data: ExportInput) -> str:
    plan = data.plan
    root = ET.Element("fcpxml", version="1.9")
    resources = ET.SubElement(root, "resources")
    ET.SubElement(
        resources, "format", id="fmt_seq", name="FFVideoFormatCustom",
        frameDuration=_frames_t(data, 1), width=str(plan.width), height=str(plan.height),
        colorSpace="1-1-1 (Rec. 709)",
    )  # fmt: skip

    used = {c.media_id for c in data.video_clips()} | {c.media_id for c in data.audio_clips()}
    formats: dict[str, str] = {}

    def format_for(item: MediaItem) -> str | None:
        if item.kind == "audio":
            return None
        if item.kind == "image":
            key, attrs = "image", {"name": "FFVideoFormatRateUndefined"}
        else:
            fps = Fraction(round((item.fps or data.fps) * 1001), 1001)
            key = f"v{fps}"
            attrs = {"name": "FFVideoFormatCustom", "frameDuration": _t(1 / fps)}
        if key not in formats:
            formats[key] = f"fmt_{len(formats)}"
            ET.SubElement(
                resources, "format", id=formats[key], width=str(item.width or plan.width),
                height=str(item.height or plan.height), colorSpace="1-1-1 (Rec. 709)", **attrs,
            )  # fmt: skip
        return formats[key]

    for media_id in sorted(used):
        item = data.media[media_id]
        attrs = {
            "id": f"asset_{media_id}", "name": item.label, "start": "0s",
            "duration": _t(item.duration_s or 0) if item.duration_s else "0s",
            "hasVideo": "1" if item.kind != "audio" else "0",
            "hasAudio": "1" if item.has_audio else "0",
            "src": "file://localhost" + str(data.media_path(item)).replace(" ", "%20"),
        }  # fmt: skip
        if fmt := format_for(item):
            attrs["format"] = fmt
        if item.has_audio:
            attrs.update(audioSources="1", audioChannels="1", audioRate="48000")
        ET.SubElement(resources, "asset", **attrs)

    library = ET.SubElement(root, "library")
    event = ET.SubElement(library, "event", name="Edith")
    project = ET.SubElement(event, "project", name=data.name)
    sequence = ET.SubElement(
        project, "sequence", format="fmt_seq", duration=_frames_t(data, data.total_frames),
        tcStart="0s", tcFormat="NDF", audioLayout="stereo", audioRate="48k",
    )  # fmt: skip
    spine = ET.SubElement(sequence, "spine")
    gap = ET.SubElement(
        spine,
        "gap",
        name="Edith",
        offset="0s",
        start="0s",
        duration=_frames_t(data, data.total_frames),
    )

    def add(clip: Clip, lane: int) -> None:
        item = data.media[clip.media_id]
        element = ET.SubElement(
            gap, "asset-clip" if item.kind != "image" else "video", ref=f"asset_{clip.media_id}",
            lane=str(lane), name=item.label, offset=_frames_t(data, clip.rec_in),
            start=_frames_t(data, clip.src_in), duration=_frames_t(data, clip.dur),
        )  # fmt: skip
        if clip.kind == "audio":
            if clip.gain_db:
                ET.SubElement(element, "adjust-volume", amount=f"{clip.gain_db:g}dB")
        elif item.kind == "video":
            ET.SubElement(element, "adjust-volume", amount="-96dB")  # discard on-camera audio

    for clip in data.video_clips():
        add(clip, 1)
    for clip in data.audio_clips():
        add(clip, -(clip.track + 1))

    ET.indent(root)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n'
        + ET.tostring(root, encoding="unicode")
        + "\n"
    )

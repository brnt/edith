"""Final Cut Pro 7 XML ("xmeml" v4): what Adobe Premiere imports (Resolve reads it too)."""

import xml.etree.ElementTree as ET

from edith.export.common import Clip, ExportInput, file_url, timecode


def _rate(parent: ET.Element, data: ExportInput) -> None:
    rate = ET.SubElement(parent, "rate")
    ET.SubElement(rate, "timebase").text = str(data.timebase)
    ET.SubElement(rate, "ntsc").text = "TRUE" if data.plan.fps_den != 1 else "FALSE"


def _text(parent: ET.Element, tag: str, value: object) -> ET.Element:
    element = ET.SubElement(parent, tag)
    element.text = str(value)
    return element


def to_xmeml(data: ExportInput) -> str:
    plan = data.plan
    root = ET.Element("xmeml", version="4")
    sequence = ET.SubElement(root, "sequence", id="sequence-1")
    _text(sequence, "name", data.name)
    _text(sequence, "duration", data.total_frames)
    _rate(sequence, data)
    timecode_el = ET.SubElement(sequence, "timecode")
    _rate(timecode_el, data)
    _text(timecode_el, "string", timecode(0, data.timebase))
    _text(timecode_el, "frame", 0)
    _text(timecode_el, "displayformat", "NDF")
    media = ET.SubElement(sequence, "media")

    defined: set[str] = set()
    counter = {"clip": 0}

    def clipitem(track: ET.Element, clip: Clip, *, is_audio: bool) -> None:
        item = data.media[clip.media_id]
        counter["clip"] += 1
        el = ET.SubElement(track, "clipitem", id=f"clipitem-{counter['clip']}")
        _text(el, "name", item.label)
        _text(el, "enabled", "TRUE")
        _text(el, "duration", data.frames(item.duration_s or clip.dur / data.fps) or clip.dur)
        _rate(el, data)
        _text(el, "start", clip.rec_in)
        _text(el, "end", clip.rec_out)
        _text(el, "in", clip.src_in)
        _text(el, "out", clip.src_out)
        file_id = f"file-{clip.media_id}"
        file_el = ET.SubElement(el, "file", id=file_id)
        if clip.media_id not in defined:
            defined.add(clip.media_id)
            _text(file_el, "name", item.label)
            _text(file_el, "pathurl", file_url(data.media_path(item)))
            _rate(file_el, data)
            _text(file_el, "duration", data.frames(item.duration_s) if item.duration_s else 1)
            file_media = ET.SubElement(file_el, "media")
            if item.kind != "audio":
                video = ET.SubElement(file_media, "video")
                sc = ET.SubElement(video, "samplecharacteristics")
                _text(sc, "width", item.width or plan.width)
                _text(sc, "height", item.height or plan.height)
            if item.has_audio:
                audio = ET.SubElement(file_media, "audio")
                _text(audio, "channelcount", 1)
        if is_audio:
            source = ET.SubElement(el, "sourcetrack")
            _text(source, "mediatype", "audio")
            _text(source, "trackindex", 1)
            if clip.gain_db:
                effect = ET.SubElement(ET.SubElement(el, "filter"), "effect")
                _text(effect, "name", "Audio Levels")
                _text(effect, "effectid", "audiolevels")
                _text(effect, "effectcategory", "audiolevels")
                _text(effect, "effecttype", "audiolevels")
                _text(effect, "mediatype", "audio")
                parameter = ET.SubElement(effect, "parameter")
                _text(parameter, "parameterid", "level")
                _text(parameter, "name", "Level")
                _text(parameter, "value", f"{10 ** (clip.gain_db / 20):.4f}")

    video = ET.SubElement(media, "video")
    fmt = ET.SubElement(ET.SubElement(video, "format"), "samplecharacteristics")
    _rate(fmt, data)
    _text(fmt, "width", plan.width)
    _text(fmt, "height", plan.height)
    _text(fmt, "pixelaspectratio", "square")
    v_track = ET.SubElement(video, "track")
    for clip in data.video_clips():
        clipitem(v_track, clip, is_audio=False)

    audio = ET.SubElement(media, "audio")
    _text(audio, "numOutputChannels", 2)
    by_track: dict[int, ET.Element] = {}
    for clip in data.audio_clips():
        if clip.track not in by_track:
            by_track[clip.track] = ET.SubElement(audio, "track")
        clipitem(by_track[clip.track], clip, is_audio=True)

    ET.indent(root)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n'
        + ET.tostring(root, encoding="unicode")
        + "\n"
    )

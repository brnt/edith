"""CMX3600 EDL: video cuts only (EDL cannot describe several audio tracks or gain)."""

import re

from edith.export.common import ExportInput, timecode


def _reel(label: str) -> str:
    stem = label.rsplit(".", 1)[0]
    return (re.sub(r"[^A-Za-z0-9]", "", stem).upper() or "AX")[:8]


def to_edl(data: ExportInput) -> str:
    tb = data.timebase
    lines = [f"TITLE: {data.name}", "FCM: NON-DROP FRAME", ""]
    for n, clip in enumerate(data.video_clips(), start=1):
        item = data.media[clip.media_id]
        lines.append(
            f"{n:03d}  {_reel(item.label):<8} V     C        "
            f"{timecode(clip.src_in, tb)} {timecode(clip.src_out, tb)} "
            f"{timecode(clip.rec_in, tb)} {timecode(clip.rec_out, tb)}"
        )
        lines.append(f"* FROM CLIP NAME: {item.label}")
    lines += ["", "* AUDIO IS NOT INCLUDED IN AN EDL; import the audio tracks from the XML export."]
    return "\n".join(lines) + "\n"

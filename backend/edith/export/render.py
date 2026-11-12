"""Compile the render plan to an ffmpeg command, in the plan's encoding (H.264 by default),
from the full-res originals.

Every clip is its own input (`-ss` then `-i`, so ffmpeg seeks instead of decoding from the
start), scaled to fit the output frame and conformed to the output frame rate; video clips are
concatenated and audio clips are delayed to their place and mixed. Camera audio is never used.
"""

import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from edith.core.errors import MediaError
from edith.db.documents import MediaItem
from edith.edit.plan import RenderPlan
from edith.export.encodings import ENCODINGS

AUDIO_RATE = 48_000


@dataclass(frozen=True)
class RenderCommand:
    args: list[str]
    duration_s: float


def build_command(
    plan: RenderPlan,
    media: dict[str, MediaItem],
    source: Callable[[MediaItem], Path],
    output: Path,
) -> RenderCommand:
    if not plan.video:
        raise MediaError("nothing to render: the edit has no video")
    w, h = plan.width, plan.height
    fps = f"{plan.fps_num}/{plan.fps_den}"
    args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"]
    filters: list[str] = []
    n = 0

    video_labels = []
    for seg in plan.video:
        item = media[seg.media_id]
        source_path = str(source(item))
        if seg.kind == "still":
            # A looped *input* (-loop 1) stalls ffmpeg inside the concat on real footage, so the
            # single frame is repeated by a filter instead. Scaling first keeps the buffer small.
            args += ["-i", source_path]
            hold = f"loop=loop={round(seg.dur_s * plan.fps_num / plan.fps_den) + 2}:size=1,"
        else:
            args += ["-ss", f"{seg.src_in_s:.6f}", "-t", f"{seg.dur_s:.6f}", "-i", source_path]
            hold = ""
        filters.append(
            f"[{n}:v:0]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,{hold}fps={fps},"
            f"trim=duration={seg.dur_s:.6f},setpts=PTS-STARTPTS[v{n}]"
        )
        video_labels.append(f"[v{n}]")
        n += 1
    filters.append(f"{''.join(video_labels)}concat=n={len(video_labels)}:v=1:a=0[vout]")

    audio_labels = []
    for seg in plan.audio:
        item = media[seg.media_id]
        args += ["-ss", f"{seg.src_in_s:.6f}", "-t", f"{seg.dur_s:.6f}", "-i", str(source(item))]
        delay_ms = round(seg.rec_in_s * 1000)
        filters.append(
            f"[{n}:a:0]aresample={AUDIO_RATE},aformat=channel_layouts=stereo,"
            f"volume={seg.gain_db:g}dB,adelay={delay_ms}|{delay_ms}[a{n}]"
        )
        audio_labels.append(f"[a{n}]")
        n += 1
    maps = ["-map", "[vout]"]
    if audio_labels:
        filters.append(
            f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:normalize=0:duration=longest[aout]"
        )
        maps += ["-map", "[aout]"]

    args += ["-filter_complex", ";\n".join(filters), *maps]
    enc = ENCODINGS[plan.encoding]
    args += enc.video
    if audio_labels:
        args += [*enc.audio, "-ar", str(AUDIO_RATE)]
    args += ["-t", f"{plan.duration_s:.6f}", *enc.container, str(output)]
    return RenderCommand(args, plan.duration_s)


def run(command: RenderCommand, on_progress: Callable[[float], None]) -> None:
    """Run ffmpeg, reporting 0..1 progress from its `-progress` stream."""
    process = subprocess.Popen(
        command.args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    assert process.stdout is not None and process.stderr is not None
    for line in process.stdout:
        match = re.match(r"out_time_us=(\d+)", line)
        if match and command.duration_s > 0:
            on_progress(min(1.0, int(match.group(1)) / 1e6 / command.duration_s))
    error = process.stderr.read()
    if process.wait() != 0:
        raise MediaError(f"render failed: {error.strip()[-800:]}")

"""ffprobe/ffmpeg access. Media is only ever read."""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from edith.core.errors import MediaError
from edith.sync.registration import SAMPLE_RATE

__all__ = ["MediaError", "MediaInfo", "extract_mono", "probe"]


@dataclass(frozen=True)
class MediaInfo:
    duration_s: float | None  # None for still images
    has_video: bool
    has_audio: bool
    width: int | None
    height: int | None
    fps: float | None
    audio_start_s: float | None
    video_start_s: float | None


def _fps(rate: str | None) -> float | None:
    try:
        num, den = (rate or "").split("/")
        return float(num) / float(den) if float(den) else None
    except ValueError:
        return None


def probe(path: Path) -> MediaInfo:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-of", "json",
            "-show_entries",
            "format=duration:stream=codec_type,start_time,width,height,avg_frame_rate"
            ":stream_disposition=attached_pic",
            str(path),
        ],
        capture_output=True,
        text=True,
    )  # fmt: skip
    if result.returncode != 0:
        raise MediaError(f"ffprobe failed for {path.name}: {result.stderr.strip()}")
    info = json.loads(result.stdout)
    streams = info.get("streams", [])
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    def start_of(stream: dict | None) -> float | None:
        value = (stream or {}).get("start_time")
        return float(value) if value not in (None, "N/A") else None

    raw_duration = info.get("format", {}).get("duration")
    duration = float(raw_duration) if raw_duration not in (None, "N/A") else None
    return MediaInfo(
        duration_s=duration,
        has_video=video is not None,
        has_audio=audio is not None,
        width=int(video["width"]) if video else None,
        height=int(video["height"]) if video else None,
        fps=_fps(video.get("avg_frame_rate")) if video and duration else None,
        audio_start_s=start_of(audio),
        video_start_s=start_of(video),
    )


def extract_mono(
    path: Path,
    *,
    start_s: float = 0.0,
    duration_s: float | None = None,
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    """Decode audio to mono float32 at `sample_rate`, optionally just a window."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if start_s > 0:
        cmd += ["-ss", f"{start_s:.6f}"]
    if duration_s is not None:
        cmd += ["-t", f"{duration_s:.6f}"]
    cmd += ["-i", str(path), "-vn", "-ac", "1", "-ar", str(sample_rate), "-f", "f32le", "-"]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise MediaError(f"ffmpeg failed for {path.name}: {result.stderr.decode().strip()}")
    return np.frombuffer(result.stdout, dtype=np.float32)

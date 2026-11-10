"""ffprobe/ffmpeg access. Media is only ever read."""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from edith.sync.registration import SAMPLE_RATE


class MediaError(RuntimeError):
    pass


@dataclass(frozen=True)
class MediaInfo:
    duration_s: float
    has_video: bool
    audio_start_s: float | None
    video_start_s: float | None


def probe(path: Path) -> MediaInfo:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-of", "json",
            "-show_entries", "format=duration:stream=codec_type,start_time",
            str(path),
        ],
        capture_output=True,
        text=True,
    )  # fmt: skip
    if result.returncode != 0:
        raise MediaError(f"ffprobe failed for {path.name}: {result.stderr.strip()}")
    info = json.loads(result.stdout)

    def start_of(kind: str) -> float | None:
        for stream in info.get("streams", []):
            if stream.get("codec_type") == kind and stream.get("start_time") not in (None, "N/A"):
                return float(stream["start_time"])
        return None

    if start_of("audio") is None and not any(
        s.get("codec_type") == "audio" for s in info.get("streams", [])
    ):
        raise MediaError(f"{path.name} has no audio stream")
    return MediaInfo(
        duration_s=float(info["format"]["duration"]),
        has_video=any(s.get("codec_type") == "video" for s in info.get("streams", [])),
        audio_start_s=start_of("audio"),
        video_start_s=start_of("video"),
    )


def extract_mono(
    path: Path, *, start_s: float = 0.0, duration_s: float | None = None
) -> np.ndarray:
    """Decode audio to mono float32 at the analysis rate, optionally just a window."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if start_s > 0:
        cmd += ["-ss", f"{start_s:.6f}"]
    if duration_s is not None:
        cmd += ["-t", f"{duration_s:.6f}"]
    cmd += ["-i", str(path), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise MediaError(f"ffmpeg failed for {path.name}: {result.stderr.decode().strip()}")
    return np.frombuffer(result.stdout, dtype=np.float32)

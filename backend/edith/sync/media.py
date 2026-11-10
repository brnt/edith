"""ffprobe/ffmpeg access. Media is only ever read."""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from edith.core.errors import MediaError
from edith.sync.registration import SAMPLE_RATE

__all__ = ["MediaError", "MediaInfo", "details", "extract_mono", "probe"]


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


def _num(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _bit_depth(stream: dict) -> int | None:
    raw = _num(stream.get("bits_per_raw_sample"))
    if raw:
        return int(raw)
    pix = stream.get("pix_fmt") or ""  # e.g. yuv420p10le: the digits after the planes are the depth
    for depth in (16, 14, 12, 10, 9):
        if f"p{depth}" in pix or f"{depth}le" in pix or f"{depth}be" in pix:
            return depth
    return 8 if pix else None


def details(path: Path) -> dict:
    """Everything worth showing about a file: container, video and audio streams (read-only)."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-of", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise MediaError(f"ffprobe failed for {path.name}: {result.stderr.strip()}")
    info = json.loads(result.stdout)
    fmt = info.get("format", {})
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
    out: dict = {
        "container": fmt.get("format_long_name") or fmt.get("format_name"),
        "size_bytes": int(fmt["size"]) if fmt.get("size") else None,
        "duration_s": _num(fmt.get("duration")),
        "bit_rate": _num(fmt.get("bit_rate")),
        "created": (fmt.get("tags") or {}).get("creation_time"),
        "video": None,
        "audio": None,
    }
    if video:
        avg, real = _fps(video.get("avg_frame_rate")), _fps(video.get("r_frame_rate"))
        out["video"] = {
            "codec": video.get("codec_name"),
            "profile": video.get("profile"),
            "width": video.get("width"),
            "height": video.get("height"),
            "fps": avg,
            "fps_variable": bool(avg and real and abs(avg - real) / real > 0.01),
            "pix_fmt": video.get("pix_fmt"),
            "bit_depth": _bit_depth(video),
            "color_space": video.get("color_space"),
            "color_range": video.get("color_range"),
            "color_transfer": video.get("color_transfer"),
            "bit_rate": _num(video.get("bit_rate")),
        }
    if audio:
        out["audio"] = {
            "codec": audio.get("codec_name"),
            "sample_rate": _num(audio.get("sample_rate")),
            "channels": audio.get("channels"),
            "channel_layout": audio.get("channel_layout"),
            "bit_rate": _num(audio.get("bit_rate")),
            "bit_depth": int(audio["bits_per_sample"]) if audio.get("bits_per_sample") else None,
        }
    return out


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

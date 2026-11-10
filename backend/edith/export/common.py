"""What every exporter needs: the plan snapped to whole frames, and file locations."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from edith.db.documents import MediaItem
from edith.edit.plan import RenderPlan


@dataclass(frozen=True)
class Clip:
    media_id: str
    kind: str  # "camera" | "still" | "audio"
    rec_in: int  # frames on the output timeline
    dur: int
    src_in: int  # frames into the source (0 for stills)
    gain_db: float = 0.0
    track: int = 0  # audio track index, in output order

    @property
    def rec_out(self) -> int:
        return self.rec_in + self.dur

    @property
    def src_out(self) -> int:
        return self.src_in + self.dur


@dataclass(frozen=True)
class ExportInput:
    name: str
    plan: RenderPlan
    media: dict[str, MediaItem]
    media_path: Callable[[MediaItem], Path]  # absolute path on the user's machine

    @property
    def fps(self) -> float:
        return self.plan.fps_num / self.plan.fps_den

    @property
    def timebase(self) -> int:
        return round(self.fps)

    @property
    def total_frames(self) -> int:
        return self.frames(self.plan.duration_s)

    def frames(self, seconds: float) -> int:
        return round(seconds * self.fps)

    def _snap(self, rec_in_s: float, dur_s: float, src_in_s: float) -> tuple[int, int, int]:
        start = self.frames(rec_in_s)
        end = self.frames(rec_in_s + dur_s)
        return start, end - start, self.frames(src_in_s)

    def video_clips(self) -> list[Clip]:
        clips = []
        for seg in self.plan.video:
            start, dur, src = self._snap(seg.rec_in_s, seg.dur_s, seg.src_in_s)
            if dur > 0:
                clips.append(Clip(seg.media_id, seg.kind, start, dur, src))
        return clips

    def audio_clips(self) -> list[Clip]:
        order: dict[str, int] = {}
        clips = []
        for seg in self.plan.audio:
            track = order.setdefault(seg.media_id, len(order))
            start, dur, src = self._snap(seg.rec_in_s, seg.dur_s, seg.src_in_s)
            if dur > 0:
                clips.append(Clip(seg.media_id, "audio", start, dur, src, seg.gain_db, track))
        return clips


def file_url(path: Path) -> str:
    return "file://localhost" + quote(str(path))


def timecode(frames: int, timebase: int) -> str:
    seconds, ff = divmod(frames, timebase)
    minutes, ss = divmod(seconds, 60)
    hh, mm = divmod(minutes, 60)
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"

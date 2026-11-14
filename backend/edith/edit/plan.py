"""Turn the edit decision list into concrete clips on the output timeline.

The plan is the single source of truth for everything downstream: preview logic mirrors it,
exporters serialise it, and a render compiles it to ffmpeg. All times are seconds.

Edit times are on the shared sync timeline (earliest file starts at 0). Cuts remove time and
close the gap (ripple), so output time = timeline time minus the cut time before it.
"""

from dataclasses import dataclass, field, replace
from typing import Literal

from edith.db.documents import CameraSwitch, EditList, MediaItem, MixRegion, SyncState

EPS = 1e-6


@dataclass(frozen=True)
class VideoSeg:
    media_id: str
    kind: Literal["camera", "still"]
    rec_in_s: float  # position on the output timeline
    dur_s: float
    src_in_s: float  # position in the source file (0 for stills)


@dataclass(frozen=True)
class AudioSeg:
    media_id: str
    rec_in_s: float
    dur_s: float
    src_in_s: float
    gain_db: float


@dataclass(frozen=True)
class RenderPlan:
    duration_s: float
    video: list[VideoSeg]
    audio: list[AudioSeg]
    fps_num: int
    fps_den: int
    width: int
    height: int
    warnings: list[str] = field(default_factory=list)
    encoding: str = "h264"


def media_offsets(media: dict[str, MediaItem], sync: SyncState) -> dict[str, float]:
    """Where each file's first sample sits on the shared timeline (sync result + nudge)."""
    offsets: dict[str, float] = {}
    for media_id, item in media.items():
        if item.kind == "image":
            continue
        result = sync.results.get(media_id)
        if result and result.status != "unsynced" and result.start_s is not None:
            offsets[media_id] = result.start_s + sync.nudges.get(media_id, 0.0)
        else:
            offsets[media_id] = sync.nudges.get(media_id, 0.0)
    return offsets


def timeline_end(media: dict[str, MediaItem], offsets: dict[str, float]) -> float:
    return max(
        (offsets[i] + (m.duration_s or 0.0) for i, m in media.items() if i in offsets), default=0.0
    )


def merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(r for r in ranges if r[1] - r[0] > EPS):
        if merged and start <= merged[-1][1] + EPS:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def keep_intervals(
    lo: float, hi: float, cuts: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    keep: list[tuple[float, float]] = []
    cursor = lo
    for start, end in merge_ranges(cuts):
        if end <= cursor or start >= hi:
            continue
        if start - cursor > EPS:
            keep.append((cursor, min(start, hi)))
        cursor = max(cursor, end)
    if hi - cursor > EPS:
        keep.append((cursor, hi))
    return keep


def default_camera(media: dict[str, MediaItem], offsets: dict[str, float]) -> str | None:
    cameras = sorted(
        (i for i, m in media.items() if m.kind == "video"),
        key=lambda i: (offsets[i], media[i].label),
    )
    return cameras[0] if cameras else None


def active_channel(switches: list[CameraSwitch], t: float, fallback: str | None) -> str | None:
    """The camera or still the output shows at `t` (None switches mean the default camera)."""
    current = fallback
    for switch in sorted(switches, key=lambda s: s.at_s):
        if switch.at_s <= t + EPS:
            current = switch.media_id if switch.media_id is not None else fallback
    return current


def output_tracks(edit: EditList, media: dict[str, MediaItem]) -> list[tuple[str, float]]:
    """(media id, gain dB) of the audio that goes into the output."""
    if edit.tracks:
        return [
            (t.media_id, t.gain_db)
            for t in edit.tracks
            if not t.muted and t.media_id in media and media[t.media_id].has_audio
        ]
    audio_only = [i for i, m in media.items() if m.kind == "audio"]
    if audio_only:
        return [(i, 0.0) for i in sorted(audio_only)]
    with_audio = sorted(i for i, m in media.items() if m.kind == "video" and m.has_audio)
    return [(with_audio[0], 0.0)] if with_audio else []


def gain_pieces(
    media_id: str, base_gain_db: float, x: float, y: float, mix: list[MixRegion]
) -> list[tuple[float, float, float]]:
    """Split [x, y) wherever a mix region on this track starts or ends: (start, end, gain dB).

    Muted stretches are left out. Where regions overlap, the one later in the list wins.
    """
    regions = [r for r in mix if r.media_id == media_id and r.end_s > x and r.start_s < y]
    points = sorted({x, y} | {t for r in regions for t in (r.start_s, r.end_s) if x < t < y})
    pieces: list[tuple[float, float, float]] = []
    for a, b in zip(points, points[1:], strict=False):
        if b - a <= EPS:
            continue
        mid = (a + b) / 2
        covering = [r for r in regions if r.start_s <= mid < r.end_s]
        region = covering[-1] if covering else None
        if region is not None and region.muted:
            continue
        pieces.append((a, b, base_gain_db + (region.gain_db if region else 0.0)))
    return pieces


def _extends(last, seg) -> bool:
    """True if `seg` continues `last`: same media, back to back on both timelines."""
    return (
        last is not None
        and last.media_id == seg.media_id
        and abs(last.rec_in_s + last.dur_s - seg.rec_in_s) < EPS
        and abs(last.src_in_s + last.dur_s - seg.src_in_s) < EPS
    )


def _append_video(segs: list[VideoSeg], seg: VideoSeg) -> None:
    last = segs[-1] if segs else None
    # A still holds one frame, so source continuity is irrelevant for it.
    same_still = (
        last is not None
        and seg.kind == last.kind == "still"
        and last.media_id == seg.media_id
        and abs(last.rec_in_s + last.dur_s - seg.rec_in_s) < EPS
    )
    if same_still or (last is not None and seg.kind == last.kind and _extends(last, seg)):
        segs[-1] = replace(last, dur_s=last.dur_s + seg.dur_s)
    else:
        segs.append(seg)


def _append_audio(segs: list[AudioSeg], seg: AudioSeg) -> None:
    last = segs[-1] if segs else None
    if last is not None and last.gain_db == seg.gain_db and _extends(last, seg):
        segs[-1] = replace(last, dur_s=last.dur_s + seg.dur_s)
    else:
        segs.append(seg)


def build_plan(edit: EditList, media: dict[str, MediaItem], sync: SyncState) -> RenderPlan:
    offsets = media_offsets(media, sync)
    warnings: list[str] = []
    fallback = default_camera(media, offsets)
    tracks = output_tracks(edit, media)

    def matters(i: str) -> bool:
        """Whether the output can use this file: its sound is in it, or it is shown (a camera or
        still switched off in the Media tab and never switched to is out of the picture)."""
        if media[i].kind == "audio":
            return i in {t[0] for t in tracks}
        return (
            i not in edit.disabled or i == fallback or any(s.media_id == i for s in edit.switches)
        )

    timed = [i for i in offsets if media[i].duration_s]
    if len(timed) > 1:
        for i in timed:
            if matters(i) and (i not in sync.results or sync.results[i].status == "unsynced"):
                warnings.append(
                    f"{media[i].label} is not synced; assuming it starts at the nudge offset"
                )

    hi = timeline_end(media, offsets)
    keep = keep_intervals(0.0, hi, [(c.start_s, c.end_s) for c in edit.cuts]) if hi > 0 else []

    video: list[VideoSeg] = []
    audio: list[AudioSeg] = []
    warned: set[str] = set()
    rec = 0.0
    for a, b in keep:
        points = {a, b} | {s.at_s for s in edit.switches if a < s.at_s < b}
        ordered = sorted(points)
        for x, y in zip(ordered, ordered[1:], strict=False):
            if y - x <= EPS:
                continue
            channel = active_channel(edit.switches, x, fallback)
            if channel is None or channel not in media:
                continue
            if media[channel].kind == "image":
                _append_video(video, VideoSeg(channel, "still", rec + (x - a), y - x, 0.0))
                continue
            src_in = x - offsets[channel]
            end = offsets[channel] + (media[channel].duration_s or 0.0)
            if (src_in < -EPS or y > end + EPS) and channel not in warned:
                warned.add(channel)
                warnings.append(f"{media[channel].label} has no footage for part of the timeline")
            _append_video(
                video, VideoSeg(channel, "camera", rec + (x - a), y - x, max(0.0, src_in))
            )
        for media_id, gain in tracks:
            start = max(a, offsets.get(media_id, 0.0))
            stop = min(b, offsets.get(media_id, 0.0) + (media[media_id].duration_s or 0.0))
            if stop - start <= EPS:
                continue
            for p, q, piece_gain in gain_pieces(media_id, gain, start, stop, edit.mix):
                _append_audio(
                    audio,
                    AudioSeg(media_id, rec + (p - a), q - p, p - offsets[media_id], piece_gain),
                )
        rec += b - a
    return RenderPlan(
        duration_s=rec,
        video=video,
        audio=audio,
        fps_num=edit.fps_num,
        fps_den=edit.fps_den,
        width=edit.width,
        height=edit.height,
        warnings=warnings,
        encoding=edit.encoding,
    )

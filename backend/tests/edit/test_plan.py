import pytest

from edith.db.documents import (
    CameraSwitch,
    Cut,
    EditList,
    MediaItem,
    Still,
    SyncResult,
    SyncState,
    TrackSetting,
)
from edith.edit.plan import build_plan, keep_intervals, merge_ranges


def item(id_, kind, duration=100.0, has_audio=True):
    return MediaItem(
        id=id_,
        path=f"{id_}.x",
        kind=kind,
        label=id_,
        duration_s=None if kind == "image" else duration,
        has_audio=has_audio and kind != "image",
    )


def synced(**starts):
    return SyncState(results={k: SyncResult(status="synced", start_s=v) for k, v in starts.items()})


MEDIA = {
    "camA": item("camA", "video"),
    "camB": item("camB", "video"),
    "mic": item("mic", "audio"),
    "car": item("car", "image"),
}
SYNC = synced(mic=0.0, camA=5.0, camB=10.0)


def test_merge_and_keep_intervals():
    assert merge_ranges([(5, 6), (1, 2), (1.5, 3), (3, 4)]) == [(1, 4), (5, 6)]
    assert keep_intervals(0, 10, [(2, 3), (8, 12), (-1, 0.5)]) == [(0.5, 2), (3, 8)]
    assert keep_intervals(0, 10, []) == [(0, 10)]
    assert keep_intervals(0, 10, [(0, 10)]) == []


def test_default_plan_follows_the_earliest_camera_and_all_audio():
    plan = build_plan(EditList(), MEDIA, SYNC)
    # camA starts at 5 s, so the timeline runs 0..110 (camB ends last) with camA as default.
    assert plan.duration_s == pytest.approx(110.0)
    assert [(s.media_id, s.rec_in_s, s.dur_s, s.src_in_s) for s in plan.video] == [
        ("camA", 0.0, 110.0, 0.0)
    ]
    assert [(a.media_id, a.rec_in_s, a.dur_s, a.src_in_s) for a in plan.audio] == [
        ("mic", 0.0, 100.0, 0.0)
    ]
    assert any("camA" in w for w in plan.warnings)  # camA has no footage past 105 s and before 5 s


def test_camera_switch_maps_timeline_time_to_source_time():
    edit = EditList(
        range_in_s=20, range_out_s=60, switches=[CameraSwitch(at_s=40, media_id="camB")]
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert [(s.media_id, s.rec_in_s, s.dur_s, s.src_in_s) for s in plan.video] == [
        ("camA", 0.0, 20.0, 15.0),  # timeline 20 -> camA source 15
        ("camB", 20.0, 20.0, 30.0),  # timeline 40 -> camB source 30
    ]
    assert plan.warnings == []


def test_cuts_ripple_and_split_clips_without_changing_source_continuity():
    edit = EditList(range_in_s=10, range_out_s=50, cuts=[Cut(start_s=20, end_s=30)])
    plan = build_plan(edit, MEDIA, SYNC)
    assert plan.duration_s == pytest.approx(30.0)
    assert [(s.rec_in_s, s.dur_s, s.src_in_s) for s in plan.video] == [(0, 10, 5), (10, 20, 25)]
    assert [(a.rec_in_s, a.dur_s, a.src_in_s) for a in plan.audio] == [(0, 10, 10), (10, 20, 30)]


def test_a_still_takes_over_video_while_audio_continues():
    edit = EditList(
        range_in_s=10, range_out_s=40, stills=[Still(id="s", media_id="car", start_s=20, end_s=25)]
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert [(s.kind, s.media_id, s.rec_in_s, s.dur_s) for s in plan.video] == [
        ("camera", "camA", 0, 10),
        ("still", "car", 10, 5),
        ("camera", "camA", 15, 15),
    ]
    assert [(a.rec_in_s, a.dur_s) for a in plan.audio] == [(0, 30)]  # one unbroken audio clip


def test_a_still_overlapping_a_cut_is_clipped_to_what_is_kept():
    edit = EditList(
        range_in_s=10,
        range_out_s=40,
        cuts=[Cut(start_s=22, end_s=30)],
        stills=[Still(id="s", media_id="car", start_s=20, end_s=26)],
    )
    plan = build_plan(edit, MEDIA, SYNC)
    stills = [s for s in plan.video if s.kind == "still"]
    assert [(s.rec_in_s, s.dur_s) for s in stills] == [(10, 2)]


def test_track_gain_and_mute():
    media = {**MEDIA, "mic2": item("mic2", "audio")}
    sync = synced(mic=0.0, mic2=0.0, camA=0.0, camB=0.0)
    edit = EditList(
        tracks=[TrackSetting(media_id="mic", gain_db=-6), TrackSetting(media_id="mic2", muted=True)]
    )
    plan = build_plan(edit, media, sync)
    assert [(a.media_id, a.gain_db) for a in plan.audio] == [("mic", -6.0)]


def test_audio_that_starts_late_is_placed_where_it_starts():
    sync = synced(mic=0.0, late=30.0, camA=0.0, camB=0.0)
    media = {**MEDIA, "late": item("late", "audio", 20)}
    plan = build_plan(EditList(range_in_s=0, range_out_s=60), media, sync)
    late = next(a for a in plan.audio if a.media_id == "late")
    assert (late.rec_in_s, late.dur_s, late.src_in_s) == (30, 20, 0)


def test_unsynced_media_is_reported_and_nudges_apply():
    sync = SyncState(
        results={
            "mic": SyncResult(status="synced", start_s=0.0),
            "camA": SyncResult(status="unsynced"),
        },
        nudges={"mic": 0.25},
    )
    plan = build_plan(
        EditList(range_in_s=0, range_out_s=10), {"camA": MEDIA["camA"], "mic": MEDIA["mic"]}, sync
    )
    assert any("camA is not synced" in w for w in plan.warnings)
    assert plan.audio[0].rec_in_s == pytest.approx(0.25)


def test_empty_project_or_range_gives_an_empty_plan():
    assert build_plan(EditList(), {}, SyncState()).duration_s == 0
    assert build_plan(EditList(range_in_s=50, range_out_s=40), MEDIA, SYNC).video == []

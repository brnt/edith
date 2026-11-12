import pytest

from edith.db.documents import (
    CameraSwitch,
    Cut,
    EditList,
    MediaItem,
    MixRegion,
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


def window(lo, hi):
    """Cuts that leave only lo..hi, for tests that want a bounded timeline."""
    return [
        c for c in (Cut(start_s=0, end_s=lo), Cut(start_s=hi, end_s=1000)) if c.end_s > c.start_s
    ]


def test_camera_switch_maps_timeline_time_to_source_time():
    edit = EditList(cuts=window(20, 60), switches=[CameraSwitch(at_s=40, media_id="camB")])
    plan = build_plan(edit, MEDIA, SYNC)
    assert [(s.media_id, s.rec_in_s, s.dur_s, s.src_in_s) for s in plan.video] == [
        ("camA", 0.0, 20.0, 15.0),  # timeline 20 -> camA source 15
        ("camB", 20.0, 20.0, 30.0),  # timeline 40 -> camB source 30
    ]
    assert plan.warnings == []


def test_cuts_ripple_and_split_clips_without_changing_source_continuity():
    edit = EditList(cuts=[*window(10, 50), Cut(start_s=20, end_s=30)])
    plan = build_plan(edit, MEDIA, SYNC)
    assert plan.duration_s == pytest.approx(30.0)
    assert [(s.rec_in_s, s.dur_s, s.src_in_s) for s in plan.video] == [(0, 10, 5), (10, 20, 25)]
    assert [(a.rec_in_s, a.dur_s, a.src_in_s) for a in plan.audio] == [(0, 10, 10), (10, 20, 30)]


def test_a_still_is_a_channel_that_takes_over_video_while_audio_continues():
    edit = EditList(
        cuts=window(10, 40),
        switches=[
            CameraSwitch(at_s=20, media_id="car"),  # cut to the still ...
            CameraSwitch(at_s=25, media_id="camA"),  # ... and back to the camera
        ],
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert [(s.kind, s.media_id, s.rec_in_s, s.dur_s) for s in plan.video] == [
        ("camera", "camA", 0, 10),
        ("still", "car", 10, 5),
        ("camera", "camA", 15, 15),
    ]
    assert [(a.rec_in_s, a.dur_s) for a in plan.audio] == [(0, 30)]  # one unbroken audio clip


def test_the_output_can_go_from_one_still_straight_to_another_and_stay_on_one():
    media = {**MEDIA, "bike": item("bike", "image")}
    edit = EditList(
        cuts=window(10, 30),
        switches=[
            CameraSwitch(at_s=12, media_id="car"),
            CameraSwitch(at_s=16, media_id="bike"),  # no camera in between
        ],
    )
    plan = build_plan(edit, media, SYNC)
    assert [(s.kind, s.media_id, s.dur_s) for s in plan.video] == [
        ("camera", "camA", 2),
        ("still", "car", 4),
        ("still", "bike", 14),  # stays on the still until the next switch
    ]


def test_a_none_switch_returns_to_the_default_camera():
    edit = EditList(
        cuts=window(20, 40),
        switches=[CameraSwitch(at_s=25, media_id="camB"), CameraSwitch(at_s=30, media_id=None)],
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert [(s.media_id, s.dur_s) for s in plan.video] == [("camA", 5), ("camB", 5), ("camA", 10)]


def test_a_still_overlapping_a_cut_is_clipped_to_what_is_kept():
    edit = EditList(
        cuts=[*window(10, 40), Cut(start_s=22, end_s=30)],
        switches=[CameraSwitch(at_s=20, media_id="car"), CameraSwitch(at_s=26, media_id="camA")],
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
    plan = build_plan(EditList(cuts=window(0, 60)), media, sync)
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
        EditList(cuts=window(0, 10)), {"camA": MEDIA["camA"], "mic": MEDIA["mic"]}, sync
    )
    assert any("camA is not synced" in w for w in plan.warnings)
    assert plan.audio[0].rec_in_s == pytest.approx(0.25)


def test_empty_project_or_all_cut_gives_an_empty_plan():
    assert build_plan(EditList(), {}, SyncState()).duration_s == 0
    assert build_plan(EditList(cuts=[Cut(start_s=0, end_s=1000)]), MEDIA, SYNC).video == []


def region(start, end, gain_db=0.0, muted=False, media_id="mic"):
    return MixRegion(media_id=media_id, start_s=start, end_s=end, gain_db=gain_db, muted=muted)


def audio_pieces(plan):
    return [(a.rec_in_s, a.dur_s, a.src_in_s, a.gain_db) for a in plan.audio]


def test_a_gain_region_splits_the_track_and_adds_to_the_track_gain():
    edit = EditList(
        cuts=window(10, 40),
        tracks=[TrackSetting(media_id="mic", gain_db=-3)],
        mix=[region(20, 25, gain_db=-6)],
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert audio_pieces(plan) == [(0, 10, 10, -3), (10, 5, 20, -9), (15, 15, 25, -3)]


def test_a_muted_region_leaves_a_gap_in_that_track_only():
    media = {**MEDIA, "mic2": item("mic2", "audio")}
    sync = synced(mic=0.0, mic2=0.0, camA=0.0, camB=0.0)
    edit = EditList(cuts=window(0, 30), mix=[region(10, 20, muted=True)])
    plan = build_plan(edit, media, sync)
    mic = [a for a in plan.audio if a.media_id == "mic"]
    other = [a for a in plan.audio if a.media_id == "mic2"]
    assert [(a.rec_in_s, a.dur_s) for a in mic] == [(0, 10), (20, 10)]
    assert [(a.rec_in_s, a.dur_s) for a in other] == [(0, 30)]  # the other mic is untouched


def test_where_regions_overlap_the_later_one_wins():
    edit = EditList(
        cuts=window(0, 30),
        mix=[region(5, 20, gain_db=-10), region(10, 15, gain_db=4)],
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert audio_pieces(plan) == [
        (0, 5, 0, 0),
        (5, 5, 5, -10),
        (10, 5, 10, 4),
        (15, 5, 15, -10),
        (20, 10, 20, 0),
    ]


def test_regions_follow_the_timeline_through_cuts():
    # The region spans a cut: the part inside the cut is gone, the rest keeps its level.
    edit = EditList(
        cuts=[*window(0, 40), Cut(start_s=18, end_s=22)],
        mix=[region(15, 30, gain_db=-6)],
    )
    plan = build_plan(edit, MEDIA, SYNC)
    assert audio_pieces(plan) == [(0, 15, 0, 0), (15, 3, 15, -6), (18, 8, 22, -6), (26, 10, 30, 0)]


def test_a_region_on_another_track_or_outside_the_range_changes_nothing():
    edit = EditList(
        cuts=window(10, 20),
        mix=[region(25, 30, muted=True), region(12, 14, muted=True, media_id="elsewhere")],
    )
    assert audio_pieces(build_plan(edit, MEDIA, SYNC)) == [(0, 10, 10, 0)]

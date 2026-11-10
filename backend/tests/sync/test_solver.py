from edith.sync.registration import Candidate
from edith.sync.solver import solve


def c(t: float, score: float = 0.6) -> Candidate:
    return Candidate(t, score)


def test_places_files_by_their_start_tones():
    # Tones are 30 s apart in every file; each device started at a different moment.
    result = solve(
        {
            "zoom": [c(13.0), c(43.0)],
            "canon": [c(7.5), c(37.5)],
            "gopro": [c(1.0), c(31.0)],
        }
    )
    assert {k: round(v.start_s, 3) for k, v in result.items()} == {
        "zoom": 0.0,
        "canon": 5.5,
        "gopro": 12.0,
    }
    assert all(v.status == "synced" for v in result.values())


def test_loud_decoys_do_not_win_over_the_consistent_pair():
    # Canon's strongest peak (0.95) is a clap that no other file hears.
    result = solve(
        {
            "zoom": [c(13.0, 0.4), c(43.0, 0.4)],
            "canon": [c(7.5, 0.5), c(37.5, 0.5), c(21.2, 0.95)],
            "gopro": [c(1.0, 0.45), c(31.0, 0.45), c(10.0, 0.2)],
        }
    )
    assert result["canon"].tone_start_s == 7.5 and result["canon"].tone_end_s == 37.5
    assert result["canon"].status == "synced"


def test_a_repeated_burst_a_second_later_counts_as_one_event():
    result = solve(
        {
            "a": [c(10.0, 0.5), c(11.155, 0.45), c(50.0, 0.5)],
            "b": [c(4.0, 0.5), c(5.155, 0.45), c(44.0, 0.5)],
        }
    )
    assert round(result["a"].start_s, 3) == 0.0 and round(result["b"].start_s, 3) == 6.0
    assert result["a"].tone_end_s == 50.0


def test_drift_is_relative_to_the_group():
    # Over an hour, one device's clock runs 100 ppm fast (0.36 s).
    result = solve(
        {
            "a": [c(10.0), c(3610.0)],
            "b": [c(20.0), c(3620.0)],
            "fast": [c(30.0), c(3630.36)],
        }
    )
    assert abs(result["fast"].drift_ppm - 100.0) < 1.0
    assert abs(result["a"].drift_ppm) < 1.0
    assert result["fast"].status == "synced"  # a plausible clock error, not a mis-located peak


def test_file_with_no_matching_pair_is_unsynced_but_others_still_sync():
    result = solve({"a": [c(10.0), c(50.0)], "b": [c(5.0), c(45.0)], "mute": []})
    assert result["mute"].status == "unsynced" and result["mute"].start_s is None
    assert result["a"].status == "synced" and result["b"].status == "synced"


def test_weak_tones_are_low_confidence():
    result = solve({"a": [c(10.0, 0.2), c(50.0, 0.2)], "b": [c(5.0, 0.2), c(45.0, 0.2)]})
    assert all(v.status == "low_confidence" for v in result.values())


def test_an_interval_mismatch_too_big_for_clock_drift_is_low_confidence():
    result = solve(
        {
            "a": [c(10.0), c(50.0)],
            "b": [c(5.0), c(45.0)],
            "off": [c(7.0), c(47.045)],  # 45 ms in 40 s = >1000 ppm
        }
    )
    assert result["off"].status == "low_confidence"
    assert result["a"].status == "synced"


def test_nothing_in_common_means_everything_unsynced():
    assert all(v.status == "unsynced" for v in solve({"a": [], "b": []}).values())

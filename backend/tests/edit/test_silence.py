import numpy as np

from edith.edit.silence import RATE, suggest_cuts


def env(*segments):
    """(seconds, dB) segments -> a dB envelope at RATE."""
    return np.concatenate([np.full(int(s * RATE), db) for s, db in segments])


def test_finds_long_silences_and_leaves_padding():
    audio = env((5, -80), (10, -20), (4, -80), (10, -20), (6, -80))
    cuts = suggest_cuts([(0.0, audio)], min_s=2.0, pad_s=0.5)
    # Silent 0-5, 15-19 and 29-35 s; each cut keeps 0.5 s of air on both sides.
    assert cuts == [(0.5, 4.5), (15.5, 18.5), (29.5, 34.5)]


def test_short_gaps_are_kept():
    audio = env((5, -20), (1.5, -80), (5, -20))
    assert suggest_cuts([(0.0, audio)], min_s=2.0) == []


def test_a_gap_is_only_dead_if_every_track_is_quiet():
    a = env((10, -20), (10, -80))
    b = env((10, -80), (10, -20))  # covers a's silence
    assert suggest_cuts([(0.0, a), (0.0, b)], min_s=2.0) == []


def test_track_offsets_place_each_track_on_the_timeline():
    a = env((5, -20))
    b = env((5, -20))
    cuts = suggest_cuts([(0.0, a), (15.0, b)], min_s=2.0, pad_s=0.0)
    assert cuts == [(5.0, 15.0)]


def test_range_limits_the_search_and_no_tracks_means_no_cuts():
    audio = env((20, -80))
    assert suggest_cuts([(0.0, audio)], min_s=2.0, pad_s=0.0, lo_s=8.0, hi_s=15.0) == [(8.0, 15.0)]
    assert suggest_cuts([]) == []


def test_threshold_decides_what_counts_as_quiet():
    audio = env((5, -45), (5, -20))
    assert suggest_cuts([(0.0, audio)], threshold_db=-50, min_s=2.0) == []
    assert suggest_cuts([(0.0, audio)], threshold_db=-40, min_s=2.0, pad_s=0.0) == [(0.0, 5.0)]

import numpy as np

from edith.sync.registration import (
    SAMPLE_RATE,
    find_candidates,
    normalized_correlation,
    registration_burst,
    trim_silence,
)

SR = SAMPLE_RATE


def _noise(seconds: float, level: float, seed: int = 0) -> np.ndarray:
    return np.random.default_rng(seed).normal(0, level, int(seconds * SR)).astype(np.float32)


def _place(audio: np.ndarray, sound: np.ndarray, at_s: float) -> None:
    i = int(at_s * SR)
    audio[i : i + len(sound)] += sound


def test_burst_is_deterministic_and_seed_dependent():
    a, b = registration_burst("stickshift"), registration_burst("stickshift")
    assert np.array_equal(a, b)
    assert len(a) == int(0.2 * SR) and abs(a).max() == 1.0
    assert not np.array_equal(a, registration_burst("other"))


def test_burst_matches_the_original_tinker_generator():
    # Fingerprint taken from stickshift/audio/registration.py (max abs diff was 0.0).
    r = np.round(registration_burst("stickshift") * 1000).astype(int)
    assert (int(r.sum()), int(np.abs(r).sum())) == (-4431, 3941449)


def test_quiet_exact_match_beats_a_loud_lookalike():
    # Regression: raw correlation ranked a clap in the content above the real, quiet tone.
    burst = registration_burst("stickshift")
    audio = _noise(12, 0.002)
    _place(audio, burst * 0.01, 3.0)
    _place(audio, np.random.default_rng(1).normal(0, 0.5, int(0.15 * SR)).astype(np.float32), 8.0)

    found = find_candidates(audio, burst)

    assert abs(found[0].time_s - 3.0) < 0.001
    assert found[0].score > 0.5
    assert all(abs(c.time_s - 8.0) > 0.1 or c.score < 0.2 for c in found)


def test_digital_silence_and_short_audio_yield_nothing():
    burst = registration_burst("stickshift")
    assert find_candidates(np.zeros(5 * SR, dtype=np.float32), burst) == []
    assert find_candidates(np.zeros(100, dtype=np.float32), burst) == []


def test_block_size_does_not_change_the_result():
    burst = registration_burst("stickshift")
    audio = _noise(4, 0.01)
    _place(audio, burst * 0.05, 1.5)
    whole = normalized_correlation(audio, burst)
    blocked = normalized_correlation(audio, burst, block=7_001)
    assert np.allclose(whole, blocked, atol=1e-5)


def test_trim_silence_drops_padding_but_keeps_the_sound():
    burst = registration_burst("stickshift")
    padded = np.concatenate([np.zeros(SR // 2), burst, np.zeros(SR)])
    trimmed = trim_silence(padded)
    assert abs(len(trimmed) - len(burst)) < 200  # the burst's own faint edges may trim a little
    assert np.array_equal(trim_silence(burst * 0), burst * 0)  # nothing loud: left alone
    assert trim_silence(np.zeros(0)).size == 0

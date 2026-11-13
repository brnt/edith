import numpy as np
import pytest

from edith.sync.registration import (
    SAMPLE_RATE,
    decode_burst,
    find_candidates,
    normalized_correlation,
    registration_burst,
    seed_bits,
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


def test_a_burst_is_read_back_with_its_bits_and_where_it_starts():
    audio = _noise(3.0, 0.002)
    _place(audio, registration_burst("stickshift") * 0.3, 1.25)
    decoded = decode_burst(audio)
    assert decoded is not None
    assert decoded.offset_s == pytest.approx(1.25, abs=0.003)
    assert decoded.bits == seed_bits("stickshift") and decoded.confidence > 0.9
    assert decoded.code == f"{int(seed_bits('stickshift'), 2):08X}"
    assert decode_burst(audio[: int(1.3 * SR)]) is None  # cut off partway: not a whole burst


def test_a_burst_is_read_through_noise_and_other_seeds_give_other_codes():
    audio = _noise(2.0, 0.15)  # the burst below is only a few dB above this
    burst = registration_burst("another seed")
    _place(audio, burst * 0.3, 0.5)
    decoded = decode_burst(audio)
    assert decoded is not None and decoded.bits == seed_bits("another seed")
    assert seed_bits("another seed") != seed_bits("stickshift")


def test_things_that_are_not_a_registration_burst_are_not_read_as_one():
    t = np.arange(3 * SR) / SR
    cases = {
        "silence": np.zeros(3 * SR),
        "noise": _noise(3.0, 0.3),
        "a low note": 0.5 * np.sin(2 * np.pi * 440 * t),
        "the 0 tone held": 0.5 * np.sin(2 * np.pi * 600 * t),
        "the 1 tone held": 0.5 * np.sin(2 * np.pi * 5500 * t),
        "a voice-like hum": sum(0.2 * np.sin(2 * np.pi * f * t) for f in (120, 240, 480, 960)),
    }
    for name, audio in cases.items():
        assert decode_burst(audio.astype(np.float32)) is None, name

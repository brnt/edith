"""Registration sounds and a normalised matched-filter search for them.

A template is any short sound: the seeded 32-bit FSK burst from the original tinker project
(`stickshift/audio/registration.py`, ported unchanged), a WAV file, or an excerpt cut from a
recording. The sound that was actually played is not always the generated one, so detection
never assumes a particular signal.

Detection returns *candidates* (time + score) and the cross-file solver (solver.py) decides
which are real. The score is **energy-normalised** cross-correlation (0..1): raw correlation
scales with loudness, so claps and thumps in the content outscored a quiet real tone.
"""

import hashlib
from dataclasses import dataclass

import numpy as np
from scipy import signal

SAMPLE_RATE = 44_100  # everything is analysed at one rate; media is resampled on extraction
BURST_SECONDS = 0.2
SEED_BITS = 32
F0_HZ = 600  # a "0" bit
F1_HZ = 5_500  # a "1" bit


@dataclass(frozen=True)
class Candidate:
    time_s: float  # where the burst starts, in the analysed file's own time
    score: float  # normalised cross-correlation, 0..1


def registration_burst(seed: str, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    n = int(BURST_SECONDS * sample_rate)
    t = np.linspace(0, BURST_SECONDS, n, False)
    digest = hashlib.sha256(seed.encode()).hexdigest()
    bits = ["1" if int(c, 16) > 7 else "0" for c in digest[:SEED_BITS]]

    samples_per_bit = n // SEED_BITS
    burst = np.zeros(n)
    for i, bit in enumerate(bits):
        # Neighbouring bits overlap by a quarter and are Hann-windowed for smooth joins.
        start = max(0, i * samples_per_bit - samples_per_bit // 4)
        end = min(n, (i + 1) * samples_per_bit + samples_per_bit // 4)
        t_bit = t[start:end] - t[start]
        freq_mod = 1.0 + 0.02 * np.sin(2 * np.pi * 10 * t_bit)
        tone = np.sin(2 * np.pi * (F1_HZ if bit == "1" else F0_HZ) * t_bit * freq_mod)
        burst[start:end] += tone * np.hanning(end - start)
    return np.float32(burst / np.max(np.abs(burst)))


def normalized_correlation(
    audio: np.ndarray, template: np.ndarray, block: int = 1 << 20
) -> np.ndarray:
    """|NCC| of the template against every position of `audio`, in blocks to bound memory.

    out[i] is in 0..1 for the template starting at sample i. Scoring against the local
    energy makes a quiet exact match beat a loud lookalike.
    """
    kernel = (template - template.mean()).astype(np.float32)
    kernel_norm = float(np.linalg.norm(kernel)) or 1.0
    m = len(kernel)
    n_out = len(audio) - m + 1
    if n_out <= 0:
        return np.zeros(0, dtype=np.float32)
    # Below this the window is digital silence; dividing by it would invent matches.
    energy_floor = (1e-4) ** 2 * m
    out = np.empty(n_out, dtype=np.float32)
    for start in range(0, n_out, block):
        stop = min(start + block, n_out)
        chunk = audio[start : stop + m - 1].astype(np.float64)
        corr = signal.correlate(chunk, kernel, mode="valid", method="fft")
        sq = np.concatenate(([0.0], np.cumsum(chunk**2)))
        energy = sq[m:] - sq[:-m]
        out[start:stop] = np.abs(corr) / (np.sqrt(np.maximum(energy, energy_floor)) * kernel_norm)
    return out


def find_candidates(
    audio: np.ndarray,
    template: np.ndarray,
    sample_rate: int = SAMPLE_RATE,
    *,
    max_candidates: int = 8,
    min_score: float = 0.15,
    min_separation_s: float = 0.3,
) -> list[Candidate]:
    """Best template matches, strongest first. Not all are real; the solver decides."""
    ncc = normalized_correlation(audio, template)
    if ncc.size == 0:
        return []
    peaks, props = signal.find_peaks(
        ncc, height=min_score, distance=max(1, int(min_separation_s * sample_rate))
    )
    order = np.argsort(props["peak_heights"])[::-1][:max_candidates]
    return [
        Candidate(float(peaks[i] / sample_rate), float(props["peak_heights"][i])) for i in order
    ]

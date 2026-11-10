"""Suggest dead time to cut: stretches where every output audio track is quiet."""

import numpy as np

RATE = 100  # envelope values per second (matches services.peaks)
MIN_CUT_S = 0.2


def suggest_cuts(
    tracks: list[tuple[float, np.ndarray]],
    *,
    threshold_db: float = -50.0,
    min_s: float = 2.0,
    pad_s: float = 0.4,
    lo_s: float = 0.0,
    hi_s: float | None = None,
) -> list[tuple[float, float]]:
    """`tracks` are (timeline offset in s, dB envelope at RATE). Returns (start, end) ranges.

    Each silent stretch of at least `min_s` is shrunk by `pad_s` on both sides so the cut
    leaves a little air around the speech.
    """
    if not tracks:
        return []
    end = hi_s if hi_s is not None else max(off + len(env) / RATE for off, env in tracks)
    n = int(np.ceil(end * RATE))
    level = np.full(n, -np.inf)
    for offset, env in tracks:
        i = int(round(offset * RATE))
        if i >= n:
            continue
        piece = env[: n - i] if i >= 0 else env[-i : n - i]
        start = max(i, 0)
        level[start : start + len(piece)] = np.maximum(level[start : start + len(piece)], piece)
    first, last = int(lo_s * RATE), n
    silent = np.zeros(n + 2, dtype=bool)
    silent[1 : n + 1] = level < threshold_db
    silent[1 : first + 1] = False
    edges = np.flatnonzero(np.diff(silent.astype(np.int8)))
    cuts: list[tuple[float, float]] = []
    for start, stop in zip(edges[::2], edges[1::2], strict=False):
        if (stop - start) / RATE < min_s:
            continue
        a, b = start / RATE + pad_s, min(stop, last) / RATE - pad_s
        if b - a >= MIN_CUT_S:
            cuts.append((round(a, 3), round(b, 3)))
    return cuts

"""Decide which tone candidates are real, then place every file on one timeline.

Protocol (the user's): every device records one registration burst shortly after it starts
and one shortly before it stops, so each file has a *start* and an *end* tone, and the
interval between them is the same real-world duration in every file. Loud look-alikes exist
(the strongest peak in a camera file was not the tone), so we never trust a single file's
best peak. Instead:

1. Form every plausible (start, end) pair per file and note its interval.
2. Find the interval that the most files can explain (score-weighted) within a tolerance.
3. In each file take the strongest pair at that interval; files with none are unsynced.

Offsets then follow from the start tones; drift from how each file's interval differs from
the group's. Nothing here touches audio, so it is fast and testable with plain numbers.
"""

from dataclasses import dataclass
from statistics import median
from typing import Literal

from edith.sync.registration import Candidate

Status = Literal["synced", "low_confidence", "unsynced"]

MIN_GAP_S = 5.0  # bursts closer than this are one event (a device may repeat or echo the tone)
BASE_TOL_S = 0.05  # interval agreement: this plus REL_TOL * interval
REL_TOL = 0.002
LOW_SCORE = 0.3  # weakest tone's normalised correlation below this => low_confidence
# Beyond this, an interval mismatch is more likely a mis-located peak than real clock drift.
RESIDUAL_BASE_S = 0.010
RESIDUAL_REL = 0.0005


@dataclass(frozen=True)
class TonePair:
    start: Candidate
    end: Candidate

    @property
    def interval_s(self) -> float:
        return self.end.time_s - self.start.time_s

    @property
    def weight(self) -> float:
        return min(self.start.score, self.end.score)


@dataclass(frozen=True)
class FileSync:
    name: str
    status: Status
    # Where this file's first sample sits on the shared timeline (earliest file = 0).
    start_s: float | None = None
    # This file's clock rate relative to the group median, in parts per million.
    drift_ppm: float | None = None
    tone_start_s: float | None = None
    tone_end_s: float | None = None
    score: float | None = None
    interval_residual_s: float | None = None


def _tolerance(interval_s: float) -> float:
    return BASE_TOL_S + REL_TOL * interval_s


def _pairs(candidates: list[Candidate]) -> list[TonePair]:
    ordered = sorted(candidates, key=lambda c: c.time_s)
    return [
        TonePair(a, b)
        for i, a in enumerate(ordered)
        for b in ordered[i + 1 :]
        if b.time_s - a.time_s >= MIN_GAP_S
    ]


def _best_within(pairs: list[TonePair], interval_s: float) -> TonePair | None:
    tol = _tolerance(interval_s)
    matching = [p for p in pairs if abs(p.interval_s - interval_s) <= tol]
    return max(matching, key=lambda p: p.weight, default=None)


def _consensus_interval(pairs_by_file: dict[str, list[TonePair]]) -> float | None:
    best_interval, best_support = None, 0.0
    for pairs in pairs_by_file.values():
        for anchor in pairs:
            support = 0.0
            for other in pairs_by_file.values():
                match = _best_within(other, anchor.interval_s)
                support += match.weight if match else 0.0
            if support > best_support:
                best_interval, best_support = anchor.interval_s, support
    return best_interval


def solve(candidates_by_file: dict[str, list[Candidate]]) -> dict[str, FileSync]:
    pairs_by_file = {name: _pairs(c) for name, c in candidates_by_file.items()}
    interval = _consensus_interval(pairs_by_file)
    chosen = (
        {name: _best_within(pairs, interval) for name, pairs in pairs_by_file.items()}
        if interval is not None
        else {name: None for name in pairs_by_file}
    )
    matched = {name: pair for name, pair in chosen.items() if pair is not None}
    if not matched:
        return {name: FileSync(name, "unsynced") for name in candidates_by_file}

    group_interval = median(p.interval_s for p in matched.values())
    latest_start = max(p.start.time_s for p in matched.values())
    result: dict[str, FileSync] = {}
    for name in candidates_by_file:
        pair = matched.get(name)
        if pair is None:
            result[name] = FileSync(name, "unsynced")
            continue
        residual = pair.interval_s - group_interval
        too_loose = abs(residual) > RESIDUAL_BASE_S + RESIDUAL_REL * group_interval
        result[name] = FileSync(
            name=name,
            status="low_confidence" if pair.weight < LOW_SCORE or too_loose else "synced",
            start_s=latest_start - pair.start.time_s,
            drift_ppm=(pair.interval_s / group_interval - 1) * 1e6,
            tone_start_s=pair.start.time_s,
            tone_end_s=pair.end.time_s,
            score=pair.weight,
            interval_residual_s=residual,
        )
    return result

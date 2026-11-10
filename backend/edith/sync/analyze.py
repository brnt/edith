from pathlib import Path

import numpy as np
import structlog

from edith.sync import media
from edith.sync.registration import (
    SAMPLE_RATE,
    Candidate,
    find_candidates,
    registration_burst,
)
from edith.sync.solver import FileSync, solve

log = structlog.get_logger()

DEFAULT_WINDOW_S = 600.0  # search this much at the start and at the end of each file


def template_from_seed(seed: str) -> np.ndarray:
    return registration_burst(seed)


def template_from_audio(
    path: Path, *, start_s: float = 0.0, duration_s: float | None = None
) -> np.ndarray:
    """A WAV of the registration sound, or an excerpt cut from a recording of it."""
    return media.extract_mono(path, start_s=start_s, duration_s=duration_s)


def tone_candidates(
    path: Path, template: np.ndarray, window_s: float = DEFAULT_WINDOW_S
) -> list[Candidate]:
    """Candidate times (in the file's own time) from its head and tail windows."""
    info = media.probe(path)
    if not info.has_audio or info.duration_s is None:
        return []
    duration = info.duration_s
    if duration <= 2 * window_s:
        windows = [(0.0, duration)]
    else:
        windows = [(0.0, window_s), (duration - window_s, window_s)]
    found: list[Candidate] = []
    for start_s, length_s in windows:
        audio = media.extract_mono(path, start_s=start_s, duration_s=length_s)
        found += [
            Candidate(c.time_s + start_s, c.score)
            for c in find_candidates(audio, template, SAMPLE_RATE)
        ]
    log.info("sync_candidates", file=path.name, count=len(found))
    return found


def sync_files(
    paths: list[Path], template: np.ndarray, window_s: float = DEFAULT_WINDOW_S
) -> dict[str, FileSync]:
    """Place every file on one timeline using its start and end registration sounds."""
    candidates = {p.name: tone_candidates(p, template, window_s) for p in paths}
    result = solve(candidates)
    for sync in result.values():
        log.info("sync_result", file=sync.name, status=sync.status, start_s=sync.start_s)
    return result

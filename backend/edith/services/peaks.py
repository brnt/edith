"""Per-media loudness envelope: drives waveforms in the UI and silence detection."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from edith.db.documents import MediaItem
from edith.services.proxies import cache_dir
from edith.sync import media

RATE = 100  # values per second
FLOOR_DB = -80.0
_ANALYSIS_RATE = 8_000  # plenty for loudness


@dataclass(frozen=True)
class Peaks:
    rate: int
    floor_db: float
    values: list[int]  # 0..255 across floor_db..0 dBFS

    def db(self) -> np.ndarray:
        return np.asarray(self.values, dtype=np.float64) / 255.0 * -self.floor_db + self.floor_db


def compute(path: Path) -> Peaks:
    audio = media.extract_mono(path, sample_rate=_ANALYSIS_RATE)
    bucket = _ANALYSIS_RATE // RATE
    n = len(audio) // bucket
    if n == 0:
        return Peaks(RATE, FLOOR_DB, [])
    peak = np.abs(audio[: n * bucket]).reshape(n, bucket).max(axis=1)
    db = 20 * np.log10(np.maximum(peak, 1e-5))
    scaled = np.clip((db - FLOOR_DB) / -FLOOR_DB * 255, 0, 255).round().astype(np.uint8)
    return Peaks(RATE, FLOOR_DB, scaled.tolist())


def get_peaks(project_folder: Path, item: MediaItem, source: Path) -> Peaks:
    cache = cache_dir(project_folder) / "peaks" / f"{item.id}.json"
    if cache.is_file():
        data = json.loads(cache.read_text())
        return Peaks(data["rate"], data["floor_db"], data["values"])
    if item.kind == "image" or not item.has_audio:
        return Peaks(RATE, FLOOR_DB, [])
    peaks = compute(source)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(
        json.dumps({"rate": peaks.rate, "floor_db": peaks.floor_db, "values": peaks.values})
    )
    return peaks

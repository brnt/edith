"""Real ffmpeg, synthetic audio: three files at different rates, started at different moments."""

import shutil
import wave
from pathlib import Path

import numpy as np
import pytest

from edith.sync import media
from edith.sync.analyze import sync_files, template_from_audio
from edith.sync.registration import registration_burst

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _write_wav(path: Path, audio: np.ndarray, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())


def _recording(rate: int, length_s: float, tones_s: list[float], seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    audio = rng.normal(0, 0.003, int(length_s * rate))
    burst = registration_burst("stickshift", rate) * 0.05
    for t in tones_s:
        i = int(t * rate)
        audio[i : i + len(burst)] += burst
    # Loud content nobody else shares, to be ignored.
    i = int(length_s * rate * 0.5)
    audio[i : i + rate // 5] += rng.normal(0, 0.6, rate // 5)
    return audio


def test_syncs_files_with_different_rates_and_start_times(tmp_path: Path):
    zoom, cam = tmp_path / "zoom.wav", tmp_path / "cam.wav"
    # 30 s between tones in both; the camera started 7.25 s after the recorder.
    _write_wav(zoom, _recording(44_100, 50, [13.0, 43.0], 1), 44_100)
    _write_wav(cam, _recording(48_000, 40, [5.75, 35.75], 2), 48_000)
    template = registration_burst("stickshift")

    result = sync_files([zoom, cam], template)

    assert result["zoom.wav"].start_s == pytest.approx(0.0, abs=0.002)
    assert result["cam.wav"].start_s == pytest.approx(7.25, abs=0.002)
    assert result["cam.wav"].status == "synced"
    assert abs(result["cam.wav"].drift_ppm) < 100


def test_probe_and_window_extraction(tmp_path: Path):
    path = tmp_path / "a.wav"
    _write_wav(path, _recording(48_000, 10, [2.0], 3), 48_000)
    info = media.probe(path)
    assert info.duration_s == pytest.approx(10.0, abs=0.01) and not info.has_video
    window = media.extract_mono(path, start_s=2.0, duration_s=1.0)
    assert len(window) == pytest.approx(44_100, abs=2)  # resampled to the analysis rate
    assert template_from_audio(path, start_s=2.0, duration_s=0.2).shape == (8820,)


def test_file_without_audio_is_rejected(tmp_path: Path):
    bogus = tmp_path / "nothing.mp4"
    bogus.write_bytes(b"not media")
    with pytest.raises(media.MediaError):
        media.probe(bogus)

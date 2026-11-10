import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.core.config import get_settings
from edith.main import app

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty, throwaway project library. The default suite never touches ./.library."""
    monkeypatch.setenv("LIBRARY_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


@pytest.fixture
def client(library: Path) -> TestClient:
    headers = {"Authorization": f"Bearer {get_settings().api_token}"}
    return TestClient(app, headers=headers)


def write_wav(path: Path, audio: np.ndarray, rate: int = 44_100) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return path


def write_video(path: Path, seconds: float = 2.0, rate: int = 30, with_audio: bool = True) -> Path:
    """A tiny synthetic test-pattern video (real ffmpeg), 320x180."""
    path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate={rate}"]
    if with_audio:
        cmd += [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-c:a",
            "aac",
            "-shortest",
        ]
    cmd += ["-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True)
    return path


def write_image(path: Path, size: str = "640x360") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=red:size={size}",
            "-frames:v",
            "1",
            str(path),
        ],
        check=True,
    )
    return path


@pytest.fixture
def project(client: TestClient) -> str:
    created = client.post("/projects", json={"name": "Test Show"})
    assert created.status_code == 201, created.text
    return created.json()["slug"]

import os
import shutil
import subprocess
import time
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from edith.core.config import get_settings
from edith.main import app

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A throwaway place for test folders, with Edith's own state kept apart from it."""
    for name in ("LIBRARY_DIR", "LEGACY_LIBRARY_DIR"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("AUTO_PROXIES", "false")  # tests ask for proxies explicitly, not in a thread
    get_settings.cache_clear()
    work = tmp_path / "work"
    work.mkdir()
    yield work
    get_settings.cache_clear()


@pytest.fixture
def project_dir(workspace: Path) -> Path:
    """The folder the `project` fixture's project lives in (made when the project is created)."""
    return workspace / "show"


@pytest.fixture
def client(workspace: Path) -> TestClient:
    headers = {"Authorization": f"Bearer {get_settings().api_token}"}
    return TestClient(app, headers=headers)


def settled(path: Path, seconds: float = 60) -> Path:
    """Make a file look old enough that discovery doesn't think it is still being copied."""
    past = time.time() - seconds
    os.utime(path, (past, past))
    return path


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
def project(client: TestClient, project_dir: Path) -> str:
    created = client.post("/projects", json={"name": "Test Show", "folder": str(project_dir)})
    assert created.status_code == 201, created.text
    return created.json()["slug"]

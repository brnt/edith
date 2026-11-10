from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from edith.core.config import get_settings
from edith.main import app


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

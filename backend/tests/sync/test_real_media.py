"""Opt-in: the real Canon / GoPro / Zoom sample session. Set EDITH_SAMPLE_MEDIA to its folder.

The registration sound there was learned from the Zoom file (13.38-13.62 s); the seeded
'stickshift' burst is not what was played.
"""

import os
from pathlib import Path

import pytest

from edith.sync.analyze import sync_files, template_from_audio

FOLDER = os.environ.get("EDITH_SAMPLE_MEDIA")
pytestmark = pytest.mark.skipif(not FOLDER, reason="EDITH_SAMPLE_MEDIA not set")


def test_sample_session_lines_up():
    media = Path(FOLDER)
    zoom, canon, gopro = media / "ZOOM0001_Tr1.WAV", media / "1W8A6696.MP4", media / "GX018177.MP4"
    template = template_from_audio(zoom, start_s=13.38, duration_s=0.24)

    result = sync_files([canon, gopro, zoom], template)

    assert result[zoom.name].start_s == pytest.approx(0.0, abs=0.001)
    assert result[gopro.name].start_s == pytest.approx(11.952, abs=0.01)
    assert result[canon.name].start_s == pytest.approx(5.622, abs=0.03)
    assert all(r.status == "synced" for r in result.values())

"""Versioned documents and the upcasters that read old versions.

The SQLite schema is frozen (see project_file.py); all evolution happens here.
Each document records the version it was written at. Reading upcasts it in memory,
one step at a time, to the current model. Nothing is rewritten until the user saves.

To change a document's shape: bump `current_version`, add an upcaster from the old
version, update the model, and add a fixture project at the old version under
tests/fixtures/ (see docs/adr/0001).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from edith.core.errors import UnsupportedVersion

Upcaster = Callable[[dict[str, Any]], dict[str, Any]]


class Document(BaseModel):
    # Unknown fields survive a round trip, so an older Edith editing a newer-minor
    # file does not silently drop data it does not understand.
    model_config = ConfigDict(extra="allow")


@dataclass(frozen=True)
class DocumentKind:
    name: str
    current_version: int
    model: type[Document]
    # upcasters[v] turns a version-v body into a version-(v+1) body.
    upcasters: dict[int, Upcaster] = field(default_factory=dict)

    def upcast(self, version: int, body: dict[str, Any]) -> Document:
        if version > self.current_version:
            raise UnsupportedVersion(
                f"{self.name} is at version {version}; this Edith reads up to "
                f"{self.current_version}. Update Edith to open it."
            )
        while version < self.current_version:
            try:
                upcaster = self.upcasters[version]
            except KeyError:
                raise ValueError(f"no upcaster for {self.name} v{version}") from None
            body = upcaster(body)
            version += 1
        return self.model.model_validate(body)


class ProjectInfo(Document):
    name: str
    created_at: datetime


PROJECT_INFO = DocumentKind("project_info", 1, ProjectInfo)
PROJECT_INFO_ID = "project"


class Part(BaseModel):
    """A nested value inside a document; unknown fields survive a round trip."""

    model_config = ConfigDict(extra="allow")


class MediaItem(Document):
    id: str
    path: str  # relative to the project folder (links in the folder are fine); never copied
    kind: Literal["video", "audio", "image"]
    label: str
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    has_audio: bool = False


class SyncTemplate(Part):
    """The registration sound, and where it comes from.

    `excerpt` (the default, and all that v1 files hold): a stretch of a registered recording.
    `seed`: generated from a text string. `file`: an audio file in the project folder.
    """

    kind: Literal["excerpt", "seed", "file"] = "excerpt"
    media_id: str | None = None
    start_s: float | None = None
    end_s: float | None = None
    seed: str | None = None
    path: str | None = None  # relative to the project folder
    duration_s: float | None = None  # the sound's actual length, recorded when syncing


class SyncResult(Part):
    status: Literal["synced", "low_confidence", "unsynced"]
    start_s: float | None = None  # file start on the shared timeline (earliest file = 0)
    drift_ppm: float | None = None
    tone_start_s: float | None = None
    tone_end_s: float | None = None
    score: float | None = None
    interval_residual_s: float | None = None


class SyncState(Document):
    template: SyncTemplate | None = None
    results: dict[str, SyncResult] = {}
    nudges: dict[str, float] = {}  # manual offset corrections, seconds, per media id


class CameraSwitch(Part):
    """From `at_s` on, the output shows this channel: a camera (video) or a still (image)."""

    at_s: float  # shared-timeline seconds; the channel stays active until the next switch
    media_id: str | None  # None = the default camera (the earliest-started video)


class Cut(Part):
    start_s: float
    end_s: float


class TrackSetting(Part):
    media_id: str
    gain_db: float = 0.0
    muted: bool = False


class MixRegion(Part):
    """A stretch of one audio track whose level differs from the rest: a gain change or a mute."""

    media_id: str
    start_s: float  # shared-timeline seconds
    end_s: float
    gain_db: float = 0.0  # added to the track's own gain
    muted: bool = False


class EditList(Document):
    """The non-destructive edit. All times are shared-timeline seconds (before cuts).

    v2: stills are channels like cameras (a switch to an image), not separate overlays.
    """

    switches: list[CameraSwitch] = []
    cuts: list[Cut] = []
    tracks: list[TrackSetting] = []  # audio that goes into the output; others are ignored
    mix: list[MixRegion] = []  # per-track level changes over time (later regions win)
    # Cameras and stills switched off in the Media tab: not in the playback grid, no channel number,
    # not decoded unless on screen. A working-set setting; it never changes the rendered output.
    disabled: list[str] = []
    fps_num: int = 30000
    fps_den: int = 1001
    width: int = 1920
    height: int = 1080


MEDIA = DocumentKind("media", 1, MediaItem)
SYNC = DocumentKind("sync", 1, SyncState)
SYNC_ID = "sync"


def _edit_v1_to_v2(body: dict[str, Any]) -> dict[str, Any]:
    """v1 stills were time-ranged overlays on top of the camera switches; v2 has only switches.

    Each still becomes a switch to it at its start and a switch back, at its end, to whichever
    channel v1 would have shown there (None = the default camera). Camera switches that sat
    hidden underneath a still are dropped, since they no longer need to be overridden.
    """
    stills = sorted(body.get("stills", []), key=lambda s: s["start_s"])
    original = sorted(body.get("switches", []), key=lambda s: s["at_s"])

    def underneath(t: float) -> str | None:
        current = None
        for switch in original:
            if switch["at_s"] <= t:
                current = switch["media_id"]
        return current

    hidden = lambda t: any(s["start_s"] < t < s["end_s"] for s in stills)  # noqa: E731
    switches = [sw for sw in original if not hidden(sw["at_s"])]
    for still in stills:
        switches.append({"at_s": still["start_s"], "media_id": still["media_id"]})
        switches.append({"at_s": still["end_s"], "media_id": underneath(still["end_s"])})
    # Where two switches land on the same instant, the one added last (the still's) wins.
    by_time = {round(sw["at_s"], 6): sw for sw in switches}
    upgraded = {k: v for k, v in body.items() if k != "stills"}
    upgraded["switches"] = [by_time[t] for t in sorted(by_time)]
    return upgraded


EDIT = DocumentKind("edit", 2, EditList, upcasters={1: _edit_v1_to_v2})
EDIT_ID = "edit"

KINDS: dict[str, DocumentKind] = {k.name: k for k in (PROJECT_INFO, MEDIA, SYNC, EDIT)}

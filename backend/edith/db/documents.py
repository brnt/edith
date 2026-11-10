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
    path: str  # relative to the library root; media is referenced in place, never copied
    kind: Literal["video", "audio", "image"]
    label: str
    duration_s: float | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    has_audio: bool = False


class SyncTemplate(Part):
    """The registration sound: an excerpt of a registered recording."""

    media_id: str
    start_s: float
    end_s: float


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
    at_s: float  # shared-timeline seconds; the camera stays active until the next switch
    media_id: str


class Cut(Part):
    start_s: float
    end_s: float


class Still(Part):
    id: str
    media_id: str  # an image; takes over the video channel, audio continues underneath
    start_s: float
    end_s: float


class TrackSetting(Part):
    media_id: str
    gain_db: float = 0.0
    muted: bool = False


class EditList(Document):
    """The non-destructive edit. All times are shared-timeline seconds (before cuts)."""

    switches: list[CameraSwitch] = []
    cuts: list[Cut] = []
    stills: list[Still] = []
    tracks: list[TrackSetting] = []  # audio that goes into the output; others are ignored
    range_in_s: float | None = None
    range_out_s: float | None = None
    fps_num: int = 30000
    fps_den: int = 1001
    width: int = 1920
    height: int = 1080


MEDIA = DocumentKind("media", 1, MediaItem)
SYNC = DocumentKind("sync", 1, SyncState)
SYNC_ID = "sync"
EDIT = DocumentKind("edit", 1, EditList)
EDIT_ID = "edit"

KINDS: dict[str, DocumentKind] = {k.name: k for k in (PROJECT_INFO, MEDIA, SYNC, EDIT)}

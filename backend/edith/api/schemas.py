from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    created_at: datetime
    needs_upgrade: bool


class MediaAdd(BaseModel):
    path: str  # relative to the library root


class MediaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    path: str
    kind: str
    label: str
    duration_s: float | None
    width: int | None
    height: int | None
    fps: float | None
    has_audio: bool
    proxy_ready: bool


class LibraryEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    path: str
    is_dir: bool
    kind: str | None
    size: int | None


class LibraryListingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dir: str
    parent: str | None
    entries: list[LibraryEntryRead]


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    state: str
    progress: float
    message: str
    error: str | None
    result: dict | None


class PeaksRead(BaseModel):
    rate: int
    floor_db: float
    values: list[int]


class SyncTemplateIn(BaseModel):
    media_id: str
    start_s: float
    end_s: float


class SyncRun(BaseModel):
    template: SyncTemplateIn


class SyncResultRead(BaseModel):
    status: str
    start_s: float | None = None
    drift_ppm: float | None = None
    tone_start_s: float | None = None
    tone_end_s: float | None = None
    score: float | None = None
    interval_residual_s: float | None = None


class SyncRead(BaseModel):
    template: SyncTemplateIn | None
    results: dict[str, SyncResultRead]
    nudges: dict[str, float]
    needs_upgrade: bool


class NudgesIn(BaseModel):
    nudges: dict[str, float]


class EditRead(BaseModel):
    edit: dict
    needs_upgrade: bool


class VideoSegRead(BaseModel):
    media_id: str
    kind: str
    rec_in_s: float
    dur_s: float
    src_in_s: float


class AudioSegRead(BaseModel):
    media_id: str
    rec_in_s: float
    dur_s: float
    src_in_s: float
    gain_db: float


class PlanRead(BaseModel):
    duration_s: float
    video: list[VideoSegRead]
    audio: list[AudioSegRead]
    fps_num: int
    fps_den: int
    width: int
    height: int
    warnings: list[str]


class CutRange(BaseModel):
    start_s: float
    end_s: float


class SilenceRead(BaseModel):
    cuts: list[CutRange]

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProjectCreate(BaseModel):
    name: str
    folder: str  # absolute path; made if it does not exist yet


class ProjectOpen(BaseModel):
    path: str  # absolute path of a .edith file, or of a folder that holds exactly one


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    file: str
    folder: str
    created_at: datetime | None
    needs_upgrade: bool
    available: bool = True
    last_opened: str | None = None


class MediaAdd(BaseModel):
    path: str  # relative to the project folder


class MediaRelink(BaseModel):
    path: str  # the file to use instead, relative to the project folder


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
    proxy_building: bool = False  # its preview is queued or being made
    included: bool = True
    missing: bool = False
    folder: str = ""
    size_bytes: int | None = None


class FolderEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    path: str
    edith_files: int
    is_project: bool


class FileEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    path: str


class MediaFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    kind: str


class FolderListingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dir: str
    parent: str | None
    entries: list[FolderEntryRead]
    files: list[FileEntryRead]
    media: list[MediaFileRead]
    media_more: int
    is_project: bool


class PlaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    path: str
    kind: str  # home | drive


class FolderCreate(BaseModel):
    parent: str
    name: str


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
    kind: Literal["excerpt", "seed", "file"] = "excerpt"
    media_id: str | None = None
    start_s: float | None = None
    end_s: float | None = None
    seed: str | None = Field(default=None, max_length=64)
    path: str | None = None

    @model_validator(mode="after")
    def _has_what_its_kind_needs(self):
        needs = {
            "excerpt": (self.media_id, self.start_s, self.end_s),
            "seed": (self.seed,),
            "file": (self.path,),
        }[self.kind]
        if any(v is None or v == "" for v in needs):
            raise ValueError(f"a {self.kind} sound is missing a field")
        return self


class SyncTemplateRead(SyncTemplateIn):
    # The sound's actual length, recorded when syncing: Autotrim cuts the sounds out whole.
    duration_s: float | None = None


class RegistrationInspectRead(BaseModel):
    found: bool
    offset_s: float | None  # where the burst starts, within the stretch
    code: str | None  # the 32 bits it carries, as 8 hex digits
    confidence: float | None


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
    template: SyncTemplateRead | None
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
    encoding: str = "h264"


class CutRange(BaseModel):
    start_s: float
    end_s: float


class SilenceRead(BaseModel):
    cuts: list[CutRange]


class RenderRead(BaseModel):
    name: str
    size: int
    modified: str  # when it was written (ISO, UTC)


class VideoDetailsRead(BaseModel):
    codec: str | None
    profile: str | None
    width: int | None
    height: int | None
    fps: float | None
    fps_variable: bool
    pix_fmt: str | None
    bit_depth: int | None
    color_space: str | None
    color_range: str | None
    color_transfer: str | None
    bit_rate: float | None


class AudioDetailsRead(BaseModel):
    codec: str | None
    sample_rate: float | None
    channels: int | None
    channel_layout: str | None
    bit_rate: float | None
    bit_depth: int | None


class MediaDetailsRead(BaseModel):
    container: str | None
    size_bytes: int | None
    duration_s: float | None
    bit_rate: float | None
    created: str | None
    image_format: str | None = None
    image_extension_matches: bool | None = None
    video: VideoDetailsRead | None
    audio: AudioDetailsRead | None

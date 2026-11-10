"""Load and save the edit, and derive the plan and silence suggestions from project documents."""

from pathlib import Path

from edith.core.errors import InvalidEdit
from edith.db.documents import (
    EDIT,
    EDIT_ID,
    MEDIA,
    SYNC,
    SYNC_ID,
    EditList,
    MediaItem,
    SyncState,
    SyncTemplate,
)
from edith.db.project_file import ProjectFile
from edith.edit import plan as planning
from edith.edit import silence
from edith.services import library as lib
from edith.services import peaks
from edith.services.projects import open_project, project_folder


def _media_by_id(project: ProjectFile) -> dict[str, MediaItem]:
    return {
        m.doc_id: m.document
        for m in project.documents_of(MEDIA)
        if isinstance(m.document, MediaItem)
    }


def _sync(project: ProjectFile) -> SyncState:
    loaded = project.get(SYNC, SYNC_ID)
    return loaded.document if loaded and isinstance(loaded.document, SyncState) else SyncState()


def get_edit(library: Path, slug: str) -> tuple[EditList, bool]:
    with open_project(library, slug) as project:
        loaded = project.get(EDIT, EDIT_ID)
    if loaded is None:
        return EditList(), False
    assert isinstance(loaded.document, EditList)
    return loaded.document, loaded.needs_upgrade


def validate(edit: EditList, media: dict[str, MediaItem]) -> None:
    for switch in edit.switches:
        if switch.media_id is not None and (
            switch.media_id not in media or media[switch.media_id].kind == "audio"
        ):
            raise InvalidEdit(f"switch refers to unknown camera or still {switch.media_id}")
    for media_id in edit.disabled:
        if media_id not in media or media[media_id].kind == "audio":
            raise InvalidEdit(f"only a camera or a still can be disabled, not {media_id}")
    for region in edit.mix:
        if region.media_id not in media or not media[region.media_id].has_audio:
            raise InvalidEdit(f"mix region refers to media without audio {region.media_id}")
        if region.end_s <= region.start_s:
            raise InvalidEdit("a mix region must end after it starts")
    for cut in edit.cuts:
        if cut.end_s <= cut.start_s:
            raise InvalidEdit("a cut must end after it starts")
    for track in edit.tracks:
        if track.media_id not in media:
            raise InvalidEdit(f"track refers to unknown media {track.media_id}")
    if (
        edit.range_in_s is not None
        and edit.range_out_s is not None
        and edit.range_out_s <= edit.range_in_s
    ):
        raise InvalidEdit("range out must be after range in")
    if edit.fps_num <= 0 or edit.fps_den <= 0 or edit.width <= 0 or edit.height <= 0:
        raise InvalidEdit("frame rate and size must be positive")


def put_edit(library: Path, slug: str, edit: EditList) -> EditList:
    """Saving writes the edit at the current version; that is what upgrades an old one."""
    with open_project(library, slug, writable=True) as project:
        validate(edit, _media_by_id(project))
        project.put(EDIT, EDIT_ID, edit)
    return edit


def build_project_plan(library: Path, slug: str) -> planning.RenderPlan:
    with open_project(library, slug) as project:
        media, sync = _media_by_id(project), _sync(project)
        loaded = project.get(EDIT, EDIT_ID)
    edit = loaded.document if loaded and isinstance(loaded.document, EditList) else EditList()
    return planning.build_plan(edit, media, sync)


# Air kept off both sides of a registration sound (its tail, the room's reverb).
REGISTRATION_MARGIN_S = 0.25


def _sound_length(template: SyncTemplate | None) -> float:
    """How long the registration sound is: recorded at sync time, else the marked excerpt, else
    the generated burst's length (older projects, and seeds, have no excerpt to measure)."""
    if template is None:
        return 0.2
    if template.duration_s:
        return template.duration_s
    if template.start_s is not None and template.end_s is not None:
        return template.end_s - template.start_s
    return 0.2


def registration_windows(
    sync: SyncState, offsets: dict[str, float], margin_s: float = REGISTRATION_MARGIN_S
) -> list[tuple[float, float]]:
    """Where the registration sounds are on the shared timeline, merged across files.

    These are sync marks, not content, so they are cut from the edit.
    """
    length = _sound_length(sync.template)
    windows: list[tuple[float, float]] = []
    for media_id, result in sync.results.items():
        if result.status == "unsynced" or media_id not in offsets:
            continue
        for tone_s in (result.tone_start_s, result.tone_end_s):
            if tone_s is not None:
                at = offsets[media_id] + tone_s
                windows.append((at - margin_s, at + length + margin_s))
    return planning.merge_ranges(windows)


def suggest_silence(
    library: Path, slug: str, *, threshold_db: float, min_s: float, pad_s: float
) -> list[tuple[float, float]]:
    folder = project_folder(library, slug)
    with open_project(library, slug) as project:
        media, sync = _media_by_id(project), _sync(project)
        loaded = project.get(EDIT, EDIT_ID)
    edit = loaded.document if loaded and isinstance(loaded.document, EditList) else EditList()
    offsets = planning.media_offsets(media, sync)
    envelopes = []
    for media_id, _gain in planning.output_tracks(edit, media):
        item = media[media_id]
        data = peaks.get_peaks(folder, item, lib.media_file(library, item.path))
        envelopes.append((offsets.get(media_id, 0.0), data.db()))
    lo = max(0.0, edit.range_in_s or 0.0)
    hi = edit.range_out_s if edit.range_out_s is not None else planning.timeline_end(media, offsets)
    marks = registration_windows(sync, offsets)
    dead = silence.suggest_cuts(
        envelopes,
        threshold_db=threshold_db,
        min_s=min_s,
        pad_s=pad_s,
        lo_s=lo,
        hi_s=hi,
        ignore=marks,
    )
    # A registration sound is cut even when speech starts right after it (no long silence).
    clipped = [(max(a, lo), min(b, hi)) for a, b in marks if b > lo and a < hi]
    return [
        (round(float(a), 3), round(float(b), 3)) for a, b in planning.merge_ranges(dead + clipped)
    ]

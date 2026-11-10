"""Load and save the edit, and derive the plan and silence suggestions from project documents."""

from pathlib import Path

from edith.core.errors import InvalidEdit
from edith.db.documents import EDIT, EDIT_ID, MEDIA, SYNC, SYNC_ID, EditList, MediaItem, SyncState
from edith.db.project_file import ProjectFile
from edith.edit import plan as planning
from edith.edit import silence
from edith.services import library as lib
from edith.services import peaks
from edith.services.projects import open_project, project_folder


def _media_by_id(project: ProjectFile) -> dict[str, MediaItem]:
    return {m.doc_id: m.document for m in project.list(MEDIA) if isinstance(m.document, MediaItem)}


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
        if media.get(switch.media_id) is None or media[switch.media_id].kind != "video":
            raise InvalidEdit(f"camera switch refers to unknown video {switch.media_id}")
    for still in edit.stills:
        if media.get(still.media_id) is None or media[still.media_id].kind != "image":
            raise InvalidEdit(f"still refers to unknown image {still.media_id}")
        if still.end_s <= still.start_s:
            raise InvalidEdit("a still must end after it starts")
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
    return silence.suggest_cuts(
        envelopes,
        threshold_db=threshold_db,
        min_s=min_s,
        pad_s=pad_s,
        lo_s=max(0.0, edit.range_in_s or 0.0),
        hi_s=edit.range_out_s
        if edit.range_out_s is not None
        else planning.timeline_end(media, offsets),
    )

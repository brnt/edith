from fastapi import APIRouter, Depends

from edith.api.schemas import CutRange, EditRead, PlanRead, SilenceRead
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.db.documents import EditList
from edith.services import editing

router = APIRouter()


@router.get("/projects/{slug}/edit", response_model=EditRead)
def get_edit(slug: str, settings: Settings = Depends(get_settings)):
    edit, needs_upgrade = editing.get_edit(slug)
    return EditRead(edit=edit.model_dump(), needs_upgrade=needs_upgrade)


@router.put("/projects/{slug}/edit", response_model=EditRead, dependencies=[Depends(require_token)])
def put_edit(slug: str, edit: EditList, settings: Settings = Depends(get_settings)):
    saved = editing.put_edit(slug, edit)
    return EditRead(edit=saved.model_dump(), needs_upgrade=False)


@router.get("/projects/{slug}/plan", response_model=PlanRead)
def get_plan(slug: str, settings: Settings = Depends(get_settings)):
    return editing.build_project_plan(slug)


@router.get("/projects/{slug}/silence", response_model=SilenceRead)
def get_silence(
    slug: str,
    threshold_db: float = -50.0,
    min_s: float = 2.0,
    pad_s: float = 0.4,
    from_s: float | None = None,
    to_s: float | None = None,
    settings: Settings = Depends(get_settings),
):
    cuts = editing.suggest_silence(
        slug, threshold_db=threshold_db, min_s=min_s, pad_s=pad_s, from_s=from_s, to_s=to_s
    )
    return SilenceRead(cuts=[CutRange(start_s=a, end_s=b) for a, b in cuts])

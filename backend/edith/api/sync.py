from fastapi import APIRouter, Depends, Query, Response, status

from edith.api.schemas import JobRead, NudgesIn, SyncRead, SyncRun
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.db.documents import SyncTemplate
from edith.services import syncing
from edith.services.jobs import Job, jobs
from edith.sync.registration import padded_wav

router = APIRouter()


def _read(state, needs_upgrade: bool) -> SyncRead:
    return SyncRead(
        template=state.template.model_dump() if state.template else None,
        results={k: v.model_dump() for k, v in state.results.items()},
        nudges=state.nudges,
        needs_upgrade=needs_upgrade,
    )


@router.get("/projects/{slug}/sync", response_model=SyncRead)
def get_sync(slug: str, settings: Settings = Depends(get_settings)):
    return _read(*syncing.get_sync(slug))


@router.post(
    "/projects/{slug}/sync",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_token)],
)
def post_sync(slug: str, payload: SyncRun, settings: Settings = Depends(get_settings)):
    template = SyncTemplate(**payload.template.model_dump())

    def work(job: Job) -> dict:
        return syncing.run_sync(slug, template, job)

    return jobs.submit(f"sync:{slug}", work)


@router.put(
    "/projects/{slug}/sync/nudges",
    response_model=SyncRead,
    dependencies=[Depends(require_token)],
)
def put_nudges(slug: str, payload: NudgesIn, settings: Settings = Depends(get_settings)):
    return _read(syncing.set_nudges(slug, payload.nudges), False)


@router.get("/registration/sound")
def get_registration_sound(
    seed: str = Query(min_length=1, max_length=64),
    lead_s: float = Query(0.5, ge=0, le=5),
    tail_s: float = Query(0.5, ge=0, le=5),
):
    """The seeded registration sound as a WAV to play on set."""
    return Response(
        padded_wav(seed, lead_s, tail_s),
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="registration.wav"'},
    )

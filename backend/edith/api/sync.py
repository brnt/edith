import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response, status

from edith.api.schemas import JobRead, NudgesIn, SyncRead, SyncRun
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.db.documents import SyncTemplate
from edith.services import syncing
from edith.services.jobs import Job, jobs
from edith.sync.registration import padded_wav

router = APIRouter()


def sound_filename(seed: str) -> str:
    """`<seed>.wav`, with what a file name can't hold swapped for a dash."""
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "-", seed).strip(" .") or "registration"
    return f"{stem[:64]}.wav"


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
    name = sound_filename(seed)
    ascii_name = name.encode("ascii", "replace").decode().replace("?", "_")
    return Response(
        padded_wav(seed, lead_s, tail_s),
        media_type="audio/wav",
        # Named after the seed (the plain name for old clients, the exact one for the rest).
        headers={
            "Content-Disposition": f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(name)}"
        },
    )

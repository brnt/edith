from fastapi import APIRouter, Depends, status
from fastapi.responses import FileResponse

from edith.api.schemas import JobRead, RenderRead
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.export.encodings import ENCODINGS
from edith.services import rendering
from edith.services.jobs import Job, jobs

router = APIRouter()

_MIME = {"." + e.ext: e.mime for e in ENCODINGS.values()}


@router.post(
    "/projects/{slug}/render",
    response_model=JobRead,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_token)],
)
def post_render(slug: str, settings: Settings = Depends(get_settings)):
    rendering.renders_dir(slug)  # validates the slug before queueing

    def work(job: Job) -> dict:
        return rendering.render_project(slug, job)

    return jobs.submit(f"render:{slug}", work)


@router.get("/projects/{slug}/renders", response_model=list[RenderRead])
def get_renders(slug: str, settings: Settings = Depends(get_settings)):
    return rendering.list_renders(slug)


@router.get("/projects/{slug}/renders/{name}")
def get_render(slug: str, name: str, settings: Settings = Depends(get_settings)):
    path = rendering.render_file(slug, name)
    return FileResponse(path, media_type=_MIME[path.suffix], filename=name)

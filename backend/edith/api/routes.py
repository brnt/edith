from fastapi import APIRouter, Depends, status

from edith.api.schemas import ProjectCreate, ProjectRead
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.services import projects as project_service

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/projects", response_model=list[ProjectRead])
def get_projects(settings: Settings = Depends(get_settings)):
    return project_service.list_projects(settings.library_dir)


@router.get("/projects/{slug}", response_model=ProjectRead)
def get_project(slug: str, settings: Settings = Depends(get_settings)):
    return project_service.get_project(settings.library_dir, slug)


@router.post(
    "/projects",
    response_model=ProjectRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_token)],
)
def post_project(payload: ProjectCreate, settings: Settings = Depends(get_settings)):
    return project_service.create_project(settings.library_dir, payload.name)


@router.post(
    "/projects/{slug}/upgrade",
    response_model=ProjectRead,
    dependencies=[Depends(require_token)],
)
def post_upgrade(slug: str, settings: Settings = Depends(get_settings)):
    """Save every document in the current format. Opening a project never does this."""
    return project_service.upgrade_project(settings.library_dir, slug)

from fastapi import APIRouter, Depends, status

from edith.api.schemas import FolderListingRead, PlaceRead, ProjectCreate, ProjectOpen, ProjectRead
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.services import filesystem
from edith.services import projects as project_service

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/projects", response_model=list[ProjectRead])
def get_projects(settings: Settings = Depends(get_settings)):
    """The recent projects, newest first (there is nothing to scan: see services/recents.py)."""
    return project_service.list_projects(settings.state_dir)


@router.get("/projects/{slug}", response_model=ProjectRead)
def get_project(slug: str):
    return project_service.get_project(slug)


@router.post(
    "/projects",
    response_model=ProjectRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_token)],
)
def post_project(payload: ProjectCreate, settings: Settings = Depends(get_settings)):
    return project_service.create_project(settings.state_dir, payload.name, payload.folder)


@router.post("/projects/open", response_model=ProjectRead, dependencies=[Depends(require_token)])
def post_open(payload: ProjectOpen, settings: Settings = Depends(get_settings)):
    """Open the project in a folder and put it on the recent list."""
    return project_service.open_folder(settings.state_dir, payload.folder)


@router.post(
    "/projects/{slug}/opened",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_token)],
)
def post_opened(slug: str, settings: Settings = Depends(get_settings)):
    project_service.touch(settings.state_dir, slug)


@router.delete(
    "/projects/{slug}/recent",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_token)],
)
def delete_recent(slug: str, settings: Settings = Depends(get_settings)):
    """Forget a project (take it off the recent list). Nothing on disk is touched."""
    project_service.forget(settings.state_dir, slug)


@router.post(
    "/projects/{slug}/upgrade",
    response_model=ProjectRead,
    dependencies=[Depends(require_token)],
)
def post_upgrade(slug: str):
    """Save every document in the current format. Opening a project never does this."""
    return project_service.upgrade_project(slug)


@router.get("/fs/folders", response_model=FolderListingRead, dependencies=[Depends(require_token)])
def get_folders(dir: str = ""):
    """Sub-folders of a folder (empty = home): how a project's folder is chosen."""
    return filesystem.list_folders(dir)


@router.get("/fs/places", response_model=list[PlaceRead], dependencies=[Depends(require_token)])
def get_places():
    return filesystem.places()

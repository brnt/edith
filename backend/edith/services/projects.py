"""Projects: a project is a folder, anywhere on disk.

The folder holds the media, `project.edith`, `renders/`, and a hidden `.edith/` cache, so it can be
moved or copied whole. A project's id (its "slug") is the folder's absolute path, URL-safe encoded.
There is no registry or library to scan: projects are created or opened, and remembered in the
recent-projects list (services/recents.py).
"""

import base64
import binascii
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import structlog

from edith.core.errors import (
    InvalidProjectName,
    NotAProjectFile,
    ProjectExists,
    ProjectNotFound,
    UnsupportedVersion,
)
from edith.db.documents import KINDS, PROJECT_INFO, PROJECT_INFO_ID, ProjectInfo
from edith.db.project_file import ProjectFile
from edith.services import recents

log = structlog.get_logger()

PROJECT_FILENAME = "project.edith"


@dataclass(frozen=True)
class ProjectSummary:
    slug: str
    name: str
    folder: str  # absolute path
    created_at: datetime | None  # None while the folder can't be read
    needs_upgrade: bool
    available: bool = True  # False: the folder (or its project file) can't be found right now
    last_opened: str | None = None


def slug_for(folder: Path) -> str:
    return base64.urlsafe_b64encode(str(folder).encode()).decode().rstrip("=")


def project_folder(slug: str) -> Path:
    """The folder a slug names (an absolute path; open checks that a project is there)."""
    try:
        folder = base64.urlsafe_b64decode(slug + "=" * (-len(slug) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise ProjectNotFound(slug) from None
    path = Path(folder)
    if not path.is_absolute() or "\0" in folder:
        raise ProjectNotFound(slug)
    return path


def _project_file_path(slug: str) -> Path:
    return project_folder(slug) / PROJECT_FILENAME


def _summarize(slug: str, project: ProjectFile) -> ProjectSummary:
    loaded = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    if loaded is None:
        raise NotAProjectFile(slug)
    info = loaded.document
    assert isinstance(info, ProjectInfo)
    stale = loaded.needs_upgrade or project.any_older_than_current(KINDS.values())
    return ProjectSummary(slug, info.name, str(project_folder(slug)), info.created_at, stale)


def _absolute(folder: str) -> Path:
    path = Path(folder).expanduser()
    if not path.is_absolute() or "\0" in folder:
        raise InvalidProjectName(folder)
    return path


def _inside_a_project(folder: Path) -> bool:
    return any((p / PROJECT_FILENAME).is_file() for p in [folder, *folder.parents])


def create_project(state_dir: Path, name: str, folder: str) -> ProjectSummary:
    """Make a project in `folder` (an absolute path; made if it does not exist yet)."""
    if not name.strip():
        raise InvalidProjectName(name)
    target = _absolute(folder)
    if _inside_a_project(target):
        raise ProjectExists(str(target))
    target.mkdir(parents=True, exist_ok=True)
    info = ProjectInfo(name=name.strip(), created_at=datetime.now(UTC))
    with ProjectFile.create(target / PROJECT_FILENAME) as project:
        project.put(PROJECT_INFO, PROJECT_INFO_ID, info)
    recents.remember(state_dir, target, info.name)
    log.info("project_created", folder=str(target))
    return ProjectSummary(slug_for(target), info.name, str(target), info.created_at, False)


def open_folder(state_dir: Path, folder: str) -> ProjectSummary:
    """Open the project in `folder` and put it on the recent list."""
    target = _absolute(folder)
    slug = slug_for(target)
    summary = get_project(slug)
    recents.remember(state_dir, target, summary.name)
    return summary


def get_project(slug: str) -> ProjectSummary:
    with ProjectFile.open(_project_file_path(slug)) as project:
        return _summarize(slug, project)


def file_stem(slug: str) -> str:
    """A file-name-safe name for things made from the project (renders, exports): its name."""
    try:
        name = get_project(slug).name
    except (NotAProjectFile, UnsupportedVersion, ProjectNotFound):
        name = ""
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", name or project_folder(slug).name).strip("-")
    return stem or "project"


def touch(state_dir: Path, slug: str) -> None:
    """Note that a project was just opened (moves it to the top of the recent list)."""
    summary = get_project(slug)
    recents.remember(state_dir, project_folder(slug), summary.name)


def forget(state_dir: Path, slug: str) -> None:
    """Take a project off the recent list. Nothing on disk is touched."""
    recents.forget(state_dir, project_folder(slug))


def list_projects(state_dir: Path) -> list[ProjectSummary]:
    """The recent projects, newest first; one that can't be read now stays, marked unavailable."""
    out: list[ProjectSummary] = []
    for r in recents.load(state_dir):
        slug = slug_for(Path(r.folder))
        try:
            summary = get_project(slug)
            out.append(
                ProjectSummary(
                    slug, summary.name, r.folder, summary.created_at, summary.needs_upgrade,
                    True, r.last_opened,
                )
            )  # fmt: skip
        except (NotAProjectFile, UnsupportedVersion, ProjectNotFound):
            out.append(ProjectSummary(slug, r.name, r.folder, None, False, False, r.last_opened))
    return out


@contextmanager
def open_project(slug: str, *, writable: bool = False) -> Iterator[ProjectFile]:
    with ProjectFile.open(_project_file_path(slug), writable=writable) as project:
        yield project


def upgrade_project(slug: str) -> ProjectSummary:
    """Rewrite every document at the current version. Only ever called on explicit request."""
    with open_project(slug, writable=True) as project:
        for kind in KINDS.values():
            for loaded in project.documents_of(kind):
                project.put(kind, loaded.doc_id, loaded.document)
    log.info("project_upgraded", slug=slug)
    return get_project(slug)

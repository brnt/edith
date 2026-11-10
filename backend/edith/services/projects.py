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
    ProjectNotFound,
    UnsupportedVersion,
)
from edith.db.documents import KINDS, PROJECT_INFO, PROJECT_INFO_ID, ProjectInfo
from edith.db.project_file import ProjectFile

log = structlog.get_logger()

PROJECT_FILENAME = "project.edith"
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass(frozen=True)
class ProjectSummary:
    slug: str
    name: str
    created_at: datetime
    needs_upgrade: bool


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64].strip("-")
    if not slug:
        raise InvalidProjectName(name)
    return slug


def _project_file_path(library: Path, slug: str) -> Path:
    # Slugs name a folder under the library; reject anything that could escape it.
    if not _SLUG_RE.fullmatch(slug):
        raise ProjectNotFound(slug)
    return library / slug / PROJECT_FILENAME


def _summarize(slug: str, project: ProjectFile) -> ProjectSummary:
    loaded = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    if loaded is None:
        raise NotAProjectFile(slug)
    info = loaded.document
    assert isinstance(info, ProjectInfo)
    stale = loaded.needs_upgrade or project.any_older_than_current(KINDS.values())
    return ProjectSummary(slug, info.name, info.created_at, stale)


def create_project(library: Path, name: str) -> ProjectSummary:
    slug = slugify(name)
    folder = library / slug
    folder.mkdir(parents=True, exist_ok=True)
    info = ProjectInfo(name=name.strip(), created_at=datetime.now(UTC))
    with ProjectFile.create(folder / PROJECT_FILENAME) as project:
        project.put(PROJECT_INFO, PROJECT_INFO_ID, info)
    log.info("project_created", slug=slug)
    return ProjectSummary(slug, info.name, info.created_at, needs_upgrade=False)


def get_project(library: Path, slug: str) -> ProjectSummary:
    with ProjectFile.open(_project_file_path(library, slug)) as project:
        return _summarize(slug, project)


def list_projects(library: Path) -> list[ProjectSummary]:
    if not library.is_dir():
        return []
    summaries: list[ProjectSummary] = []
    for folder in sorted(library.iterdir()):
        if not (folder / PROJECT_FILENAME).is_file():
            continue
        try:
            summaries.append(get_project(library, folder.name))
        except (NotAProjectFile, UnsupportedVersion, ProjectNotFound) as exc:
            # One unreadable project must not hide the rest of the library.
            log.warning("project_skipped", slug=folder.name, reason=type(exc).__name__)
    return summaries


def project_folder(library: Path, slug: str) -> Path:
    return _project_file_path(library, slug).parent


@contextmanager
def open_project(library: Path, slug: str, *, writable: bool = False) -> Iterator[ProjectFile]:
    with ProjectFile.open(_project_file_path(library, slug), writable=writable) as project:
        yield project


def upgrade_project(library: Path, slug: str) -> ProjectSummary:
    """Rewrite every document at the current version. Only ever called on explicit request."""
    with open_project(library, slug, writable=True) as project:
        for kind in KINDS.values():
            for loaded in project.documents_of(kind):
                project.put(kind, loaded.doc_id, loaded.document)
    log.info("project_upgraded", slug=slug)
    return get_project(library, slug)

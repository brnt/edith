"""Projects: a `.edith` file, in a folder with its media, anywhere on disk.

The folder holds the media, the project file, `renders/`, and a hidden `.edith/` cache, so it can be
moved or copied whole. A project's id (its "slug") is its file's absolute path, URL-safe encoded;
its folder is the file's parent. A folder can hold several project files (two cuts of one shoot):
they share the media and the cache. There is no registry or library to scan: projects are created
or opened, and remembered in the recent-projects list (services/recents.py).
"""

import base64
import binascii
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

import structlog

from edith.core.errors import (
    AmbiguousProject,
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

PROJECT_FILENAME = "project.edith"  # what a new project's file is called
PROJECT_SUFFIX = ".edith"


@dataclass(frozen=True)
class ProjectSummary:
    slug: str
    name: str
    file: str  # absolute path of the .edith file
    folder: str  # absolute path of the folder it is in (where the media is)
    created_at: datetime | None  # None while the folder can't be read
    needs_upgrade: bool
    available: bool = True  # False: the folder (or its project file) can't be found right now
    last_opened: str | None = None


def slug_for(file: Path) -> str:
    return base64.urlsafe_b64encode(str(file).encode()).decode().rstrip("=")


def project_file(slug: str) -> Path:
    """The `.edith` file a slug names (an absolute path; open checks that it exists)."""
    try:
        decoded = base64.urlsafe_b64decode(slug + "=" * (-len(slug) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise ProjectNotFound(slug) from None
    path = Path(decoded)
    if not path.is_absolute() or "\0" in decoded or path.suffix != PROJECT_SUFFIX:
        raise ProjectNotFound(slug)
    return path


def project_folder(slug: str) -> Path:
    """The folder of a project: its file's folder, where its media is."""
    return project_file(slug).parent


def edith_files(folder: Path) -> list[Path]:
    """The project files in a folder: every `*.edith` (not macOS's `._` shadow files), by name."""
    try:
        return sorted(
            p
            for p in folder.glob(f"*{PROJECT_SUFFIX}")
            if p.is_file() and not p.name.startswith(".")
        )
    except OSError:
        return []


def project_file_in(folder: Path) -> Path | None:
    """A folder's project file when it is unambiguous: `project.edith`, else the only `*.edith`."""
    default = folder / PROJECT_FILENAME
    if default.is_file():
        return default
    found = edith_files(folder)
    return found[0] if len(found) == 1 else None


def _project_file_path(slug: str) -> Path:
    return project_file(slug)


def _summarize(slug: str, project: ProjectFile) -> ProjectSummary:
    loaded = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    if loaded is None:
        raise NotAProjectFile(slug)
    info = loaded.document
    assert isinstance(info, ProjectInfo)
    stale = loaded.needs_upgrade or project.any_older_than_current(KINDS.values())
    file = project_file(slug)
    return ProjectSummary(slug, info.name, str(file), str(file.parent), info.created_at, stale)


def _absolute(folder: str) -> Path:
    """An absolute path from what the user typed or picked (`~` allowed)."""
    path = Path(folder).expanduser()
    if not path.is_absolute() or "\0" in folder:
        raise InvalidProjectName(folder)
    return path


def _inside_another_project(folder: Path) -> bool:
    """Whether a folder *above* this one holds a project (its media would swallow this folder)."""
    return any(edith_files(parent) for parent in folder.parents)


def _file_stem(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "-", name).strip(" -.")
    return stem or "project"


def create_project(state_dir: Path, name: str, folder: str) -> ProjectSummary:
    """Make a project in `folder` (an absolute path; made if it does not exist yet).

    The file is `project.edith`, or named after the project when the folder already has one (a
    second project on the same media).
    """
    if not name.strip():
        raise InvalidProjectName(name)
    target = _absolute(folder)
    if _inside_another_project(target):
        raise ProjectExists(str(target))
    target.mkdir(parents=True, exist_ok=True)
    file = target / PROJECT_FILENAME
    if file.exists():
        file = target / f"{_file_stem(name)}{PROJECT_SUFFIX}"
    info = ProjectInfo(name=name.strip(), created_at=datetime.now(UTC))
    with ProjectFile.create(file) as project:  # refuses to overwrite a file that is there
        project.put(PROJECT_INFO, PROJECT_INFO_ID, info)
    recents.remember(state_dir, file, info.name)
    log.info("project_created", file=str(file))
    return ProjectSummary(slug_for(file), info.name, str(file), str(target), info.created_at, False)


def open_path(state_dir: Path, path: str) -> ProjectSummary:
    """Open a project: a `.edith` file, or a folder with exactly one. It joins the recent list."""
    target = _absolute(path)
    if target.is_dir():
        found = edith_files(target)
        if not found:
            raise ProjectNotFound(str(target))
        file = project_file_in(target)
        if file is None:
            raise AmbiguousProject(f"{target.name} has more than one .edith file: choose one")
    else:
        file = target
    slug = slug_for(file)
    summary = get_project(slug)
    recents.remember(state_dir, file, summary.name)
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
    recents.remember(state_dir, project_file(slug), summary.name)


def forget(state_dir: Path, slug: str) -> None:
    """Take a project off the recent list. Nothing on disk is touched."""
    recents.forget(state_dir, project_file(slug))


def list_projects(state_dir: Path) -> list[ProjectSummary]:
    """The recent projects, newest first; one that can't be read now stays, marked unavailable."""
    out: list[ProjectSummary] = []
    for r in recents.load(state_dir):
        file = Path(r.file)
        slug = slug_for(file)
        try:
            found = get_project(slug)
            out.append(replace(found, last_opened=r.last_opened))
        except (NotAProjectFile, UnsupportedVersion, ProjectNotFound):
            out.append(
                ProjectSummary(
                    slug, r.name, r.file, str(file.parent), None, False, False, r.last_opened
                )
            )
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

"""Projects: a `.edith` file, in a folder with its media, anywhere on disk.

The folder holds the media, the project file, `renders/`, and a hidden `.edith/` cache, so it can be
moved or copied whole. A project's id (its "slug") is a GUID that Edith gives its file and keeps in
its state folder (services/project_ids.py); its folder is the file's parent. A folder can hold
several project files (two cuts of one shoot): they share the media and the cache. There is no
library to scan: projects are created or opened, and remembered in the recent-projects list
(services/recents.py).
"""

import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

import structlog

from edith.core.config import get_settings
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
from edith.services import project_ids, recents

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
    """The id of a project file (a GUID, made the first time Edith meets the file)."""
    return project_ids.id_for(get_settings().state_dir, file)


def project_file(slug: str) -> Path:
    """The `.edith` file an id names (an absolute path; open checks that it exists)."""
    try:
        uuid.UUID(slug)
    except ValueError:
        raise ProjectNotFound(slug) from None
    path = project_ids.file_for(get_settings().state_dir, slug)
    if path is None or not path.is_absolute() or path.suffix != PROJECT_SUFFIX:
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


def _name_of(file: Path) -> str | None:
    """A project file's name, or None when it can't be read as a project."""
    try:
        with ProjectFile.open(file) as project:
            loaded = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    except (OSError, NotAProjectFile, UnsupportedVersion):
        return None
    return loaded.document.name if loaded and isinstance(loaded.document, ProjectInfo) else None


def _file_stem(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "-", name).strip(" -.")
    return stem or "project"


def create_project(state_dir: Path, name: str, folder: str) -> ProjectSummary:
    """Make a project in `folder` (an absolute path; made if it does not exist yet).

    The file is `project.edith`, or named after the project when the folder already has one (a
    second project on the same media). A project of the same name in the same folder gets a
    number ("Show 2"), so a project can simply be named after its folder.
    """
    if not name.strip():
        raise InvalidProjectName(name)
    target = _absolute(folder)
    if _inside_another_project(target):
        raise ProjectExists(str(target))
    target.mkdir(parents=True, exist_ok=True)
    base = name.strip()
    taken = {_name_of(f) for f in edith_files(target)}
    name, number = base, 1
    while name in taken:  # two projects of one folder never share a name
        number += 1
        name = f"{base} {number}"
    file = target / PROJECT_FILENAME
    if file.exists():
        file = target / f"{_file_stem(name)}{PROJECT_SUFFIX}"
        while file.exists():
            number += 1
            name = f"{base} {number}"
            file = target / f"{_file_stem(name)}{PROJECT_SUFFIX}"
    info = ProjectInfo(name=name, created_at=datetime.now(UTC))
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
    """The recent projects, the most recently opened first.

    One whose file can't be read now (a drive unplugged, a file moved) is left out of the list but
    kept in the recent file, so it is back when the file is.
    """
    out: list[ProjectSummary] = []
    # Most recently opened first (by the time, not the file's order: imports are added at the end).
    for r in sorted(recents.load(state_dir), key=lambda r: r.last_opened, reverse=True):
        file = Path(r.file)
        slug = slug_for(file)
        try:
            found = get_project(slug)
            out.append(replace(found, last_opened=r.last_opened))
        except (NotAProjectFile, UnsupportedVersion, ProjectNotFound):
            continue
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

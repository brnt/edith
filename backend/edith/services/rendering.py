import re
from datetime import UTC, datetime
from pathlib import Path

import structlog

from edith.core.errors import MediaNotFound
from edith.db.documents import MEDIA, MediaItem
from edith.export import render
from edith.services import editing
from edith.services import mediafiles as lib
from edith.services.jobs import Job
from edith.services.projects import file_stem, open_project, project_folder

log = structlog.get_logger()

_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+\.mp4$")


def renders_dir(slug: str) -> Path:
    return project_folder(slug) / "renders"


def render_project(slug: str, job: Job) -> dict:
    """Render the saved edit to <project>/renders/<name>-<time>.mp4."""
    plan = editing.build_project_plan(slug)
    with open_project(slug) as project:
        media = {
            m.doc_id: m.document
            for m in project.documents_of(MEDIA)
            if isinstance(m.document, MediaItem)
        }
    out_dir = renders_dir(slug)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{file_stem(slug)}-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.mp4"
    partial = out_dir / f"{name}.partial.mp4"
    command = render.build_command(
        plan, media, lambda item: lib.media_file(project_folder(slug), item.path), partial
    )
    job.message = f"rendering {plan.duration_s:.0f} s"
    try:
        render.run(command, lambda fraction: setattr(job, "progress", fraction))
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    partial.replace(out_dir / name)
    log.info("render_done", slug=slug, name=name, seconds=round(plan.duration_s, 1))
    return {"name": name, "duration_s": plan.duration_s}


def list_renders(slug: str) -> list[dict]:
    folder = renders_dir(slug)
    if not folder.is_dir():
        return []
    files = sorted(
        (f for f in folder.glob("*.mp4") if _NAME_RE.match(f.name) and ".partial" not in f.name),
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    return [{"name": f.name, "size": f.stat().st_size} for f in files]


def render_file(slug: str, name: str) -> Path:
    path = renders_dir(slug) / name
    if not _NAME_RE.match(name) or not path.is_file():
        raise MediaNotFound(name)
    return path

"""Run sync over a project's media and keep the result (and manual nudges) in the project."""

from dataclasses import asdict
from pathlib import Path

import numpy as np
import structlog

from edith.core.errors import InvalidTemplate
from edith.db.documents import (
    MEDIA,
    SYNC,
    SYNC_ID,
    MediaItem,
    SyncResult,
    SyncState,
    SyncTemplate,
)
from edith.services import library as lib
from edith.services import media_items
from edith.services.jobs import Job
from edith.services.projects import open_project
from edith.sync import analyze

log = structlog.get_logger()

MAX_TEMPLATE_S = 5.0
MIN_TEMPLATE_S = 0.05


def get_sync(library: Path, slug: str) -> tuple[SyncState, bool]:
    with open_project(library, slug) as project:
        loaded = project.get(SYNC, SYNC_ID)
    if loaded is None:
        return SyncState(), False
    assert isinstance(loaded.document, SyncState)
    return loaded.document, loaded.needs_upgrade


def _template_audio(library: Path, item: MediaItem, template: SyncTemplate) -> np.ndarray:
    length = template.end_s - template.start_s
    if not MIN_TEMPLATE_S <= length <= MAX_TEMPLATE_S or template.start_s < 0:
        raise InvalidTemplate(f"excerpt must be {MIN_TEMPLATE_S}-{MAX_TEMPLATE_S}s long")
    audio = analyze.template_from_audio(
        lib.media_file(library, item.path), start_s=template.start_s, duration_s=length
    )
    if audio.size == 0 or float(np.abs(audio).max()) < 1e-4:
        raise InvalidTemplate("excerpt is silent or outside the recording")
    return audio


def run_sync(library: Path, slug: str, template: SyncTemplate, job: Job) -> dict:
    with open_project(library, slug) as project:
        items = {m.doc_id: m.document for m in project.documents_of(MEDIA)}
    source = items.get(template.media_id)
    if not isinstance(source, MediaItem):
        raise media_items.MediaNotFound(template.media_id)
    audio = _template_audio(library, source, template)

    paths = {
        i.id: lib.media_file(library, i.path)
        for i in items.values()
        if isinstance(i, MediaItem) and i.kind != "image" and i.has_audio
    }
    job.message = "searching for the registration sound"
    found = analyze.sync_files(
        paths,
        audio,
        on_progress=lambda key, fraction: (
            setattr(job, "progress", fraction * 0.95),
            setattr(job, "message", items[key].label),
        ),
    )
    results = {
        key: SyncResult(**{k: v for k, v in asdict(sync).items() if k != "name"})
        for key, sync in found.items()
    }
    with open_project(library, slug, writable=True) as project:
        previous = project.get(SYNC, SYNC_ID)
        nudges = (
            previous.document.nudges
            if previous and isinstance(previous.document, SyncState)
            else {}
        )
        project.put(SYNC, SYNC_ID, SyncState(template=template, results=results, nudges=nudges))
    log.info("sync_saved", slug=slug, files=len(results))
    return {"synced": sum(r.status != "unsynced" for r in results.values()), "files": len(results)}


def set_nudges(library: Path, slug: str, nudges: dict[str, float]) -> SyncState:
    with open_project(library, slug, writable=True) as project:
        loaded = project.get(SYNC, SYNC_ID)
        state = (
            loaded.document if loaded and isinstance(loaded.document, SyncState) else SyncState()
        )
        state.nudges = {k: v for k, v in nudges.items() if v != 0.0}
        project.put(SYNC, SYNC_ID, state)
    return state

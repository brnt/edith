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
    Document,
    MediaItem,
    SyncResult,
    SyncState,
    SyncTemplate,
)
from edith.services import media_items
from edith.services import mediafiles as lib
from edith.services.jobs import Job
from edith.services.projects import open_project, project_folder
from edith.sync import analyze
from edith.sync.registration import trim_silence

log = structlog.get_logger()

MAX_TEMPLATE_S = 5.0
MIN_TEMPLATE_S = 0.05


def get_sync(slug: str) -> tuple[SyncState, bool]:
    with open_project(slug) as project:
        loaded = project.get(SYNC, SYNC_ID)
    if loaded is None:
        return SyncState(), False
    assert isinstance(loaded.document, SyncState)
    return loaded.document, loaded.needs_upgrade


def _checked(audio: np.ndarray) -> np.ndarray:
    length = len(audio) / analyze.SAMPLE_RATE
    if audio.size == 0 or float(np.abs(audio).max()) < 1e-4:
        raise InvalidTemplate("the sound is silent or empty")
    if not MIN_TEMPLATE_S <= length <= MAX_TEMPLATE_S:
        raise InvalidTemplate(f"the sound must be {MIN_TEMPLATE_S}-{MAX_TEMPLATE_S}s long")
    return audio


def _template_audio(folder: Path, items: dict[str, Document], template: SyncTemplate) -> np.ndarray:
    if template.kind == "seed":
        if not template.seed:
            raise InvalidTemplate("a seed needs some text")
        return analyze.template_from_seed(template.seed)

    if template.kind == "file":
        if not template.path or lib.kind_for(template.path) != "audio":
            raise InvalidTemplate("pick an audio file from the project folder")
        audio = analyze.template_from_audio(lib.media_file(folder, template.path))
        return _checked(trim_silence(audio))  # generated sounds come padded with silence

    source = items.get(template.media_id or "")
    if not isinstance(source, MediaItem) or template.start_s is None or template.end_s is None:
        raise media_items.MediaNotFound(template.media_id or "")
    length = template.end_s - template.start_s
    if not MIN_TEMPLATE_S <= length <= MAX_TEMPLATE_S or template.start_s < 0:
        raise InvalidTemplate(f"excerpt must be {MIN_TEMPLATE_S}-{MAX_TEMPLATE_S}s long")
    return _checked(
        analyze.template_from_audio(
            lib.media_file(folder, source.path), start_s=template.start_s, duration_s=length
        )
    )


def run_sync(slug: str, template: SyncTemplate, job: Job) -> dict:
    with open_project(slug) as project:
        items = {m.doc_id: m.document for m in project.documents_of(MEDIA)}
    folder = project_folder(slug)
    audio = _template_audio(folder, items, template)
    template = template.model_copy(update={"duration_s": len(audio) / analyze.SAMPLE_RATE})

    paths = {
        i.id: lib.media_file(folder, i.path)
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
    with open_project(slug, writable=True) as project:
        previous = project.get(SYNC, SYNC_ID)
        nudges = (
            previous.document.nudges
            if previous and isinstance(previous.document, SyncState)
            else {}
        )
        project.put(SYNC, SYNC_ID, SyncState(template=template, results=results, nudges=nudges))
    log.info("sync_saved", slug=slug, files=len(results))
    return {"synced": sum(r.status != "unsynced" for r in results.values()), "files": len(results)}


def set_nudges(slug: str, nudges: dict[str, float]) -> SyncState:
    with open_project(slug, writable=True) as project:
        loaded = project.get(SYNC, SYNC_ID)
        state = (
            loaded.document if loaded and isinstance(loaded.document, SyncState) else SyncState()
        )
        state.nudges = {k: v for k, v in nudges.items() if v != 0.0}
        project.put(SYNC, SYNC_ID, state)
    return state

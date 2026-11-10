from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from edith.api.schemas import (
    JobRead,
    MediaAdd,
    MediaDetailsRead,
    MediaRead,
    MediaRelink,
    PeaksRead,
)
from edith.core.auth import require_token
from edith.core.config import Settings, get_settings
from edith.services import autoproxy, media_items, peaks, proxies, thumbnails
from edith.services import mediafiles as lib
from edith.services.jobs import jobs
from edith.services.projects import open_project, project_folder
from edith.sync import media as probing

router = APIRouter()


def _media_read(record: media_items.MediaRecord, building: set[str] = frozenset()) -> MediaRead:
    return MediaRead(
        **record.item.model_dump(),
        proxy_ready=record.proxy_ready,
        proxy_building=record.item.id in building,
        included=record.included,
        missing=record.missing,
        folder=record.folder,
        size_bytes=record.size_bytes,
    )


@router.get("/projects/{slug}/media", response_model=list[MediaRead])
def get_media(slug: str, settings: Settings = Depends(get_settings)):
    records = media_items.list_media(slug, with_available=True)
    # Previews are made as media is detected, in the background; the ids still waiting say so.
    building = autoproxy.ensure(slug, records) if settings.auto_proxies else set()
    return [_media_read(r, building) for r in records]


@router.post(
    "/projects/{slug}/media",
    response_model=MediaRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_token)],
)
def post_media(slug: str, payload: MediaAdd, settings: Settings = Depends(get_settings)):
    return _media_read(media_items.include_media(slug, payload.path))


@router.post(
    "/projects/{slug}/media/{media_id}/relink",
    response_model=MediaRead,
    dependencies=[Depends(require_token)],
)
def post_relink(
    slug: str, media_id: str, payload: MediaRelink, settings: Settings = Depends(get_settings)
):
    return _media_read(media_items.relink_media(slug, media_id, payload.path))


@router.get("/projects/{slug}/media/{media_id}/proxy")
def get_proxy(slug: str, media_id: str, settings: Settings = Depends(get_settings)):
    folder = project_folder(slug)
    with open_project(slug) as project:
        item = media_items.get_item(project, media_id)
    path = proxies.proxy_path(folder, item)
    if not path.is_file() and item.kind == "image":
        # A picture's proxy takes a blink, so make it when it is first wanted: a still used in the
        # edit shows in the viewer without anyone having to build proxies first.
        path = proxies.build_proxy(lib.media_file(folder, item.path), item, folder)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "proxy not built yet")
    return FileResponse(path, media_type=proxies.proxy_mime(path))


@router.get("/projects/{slug}/media/{media_id}/thumb")
def get_thumbnail(slug: str, media_id: str, settings: Settings = Depends(get_settings)):
    folder = project_folder(slug)
    item = media_items.resolve_item(slug, media_id)
    path = thumbnails.build_thumbnail(lib.media_file(folder, item.path), item, folder)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "audio has no picture")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@router.get("/projects/{slug}/media/{media_id}/details", response_model=MediaDetailsRead)
def get_details(slug: str, media_id: str, settings: Settings = Depends(get_settings)):
    folder = project_folder(slug)
    item = media_items.resolve_item(slug, media_id)
    return probing.details(lib.media_file(folder, item.path))


@router.get("/projects/{slug}/media/{media_id}/peaks", response_model=PeaksRead)
def get_peaks(slug: str, media_id: str, settings: Settings = Depends(get_settings)):
    folder = project_folder(slug)
    item = media_items.resolve_item(slug, media_id)
    source = lib.media_file(folder, item.path)
    return peaks.get_peaks(folder, item, source)


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown job")
    return job

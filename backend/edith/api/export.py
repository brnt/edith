from typing import Literal

from fastapi import APIRouter, Depends, Response

from edith.core.config import Settings, get_settings
from edith.services import exporting

router = APIRouter()


@router.get("/projects/{slug}/export/{fmt}")
def get_export(
    slug: str,
    fmt: Literal["json", "fcpxml", "xmeml", "edl"],
    settings: Settings = Depends(get_settings),
):
    body, media_type, filename = exporting.export(slug, fmt)
    return Response(
        body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

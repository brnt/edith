from pathlib import Path

from edith.db.documents import MEDIA, PROJECT_INFO, PROJECT_INFO_ID, MediaItem, ProjectInfo
from edith.export import bundle, common, edl, fcpxml, xmeml
from edith.services import editing
from edith.services.projects import open_project

FORMATS = {
    "json": ("application/json", "json"),
    "fcpxml": ("application/xml", "fcpxml"),
    "xmeml": ("application/xml", "xml"),
    "edl": ("text/plain", "edl"),
}


def export(library: Path, host_library: str, slug: str, fmt: str) -> tuple[str, str, str]:
    """(body, media type, file extension)."""
    media_type, ext = FORMATS[fmt]
    if fmt == "json":
        with open_project(library, slug) as project:
            return bundle.to_bundle(slug, project), media_type, ext
    plan = editing.build_project_plan(library, slug)
    with open_project(library, slug) as project:
        media = {
            m.doc_id: m.document
            for m in project.documents_of(MEDIA)
            if isinstance(m.document, MediaItem)
        }
        info = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    name = info.document.name if info and isinstance(info.document, ProjectInfo) else slug
    root = Path(host_library) if host_library else library.resolve()
    data = common.ExportInput(name, plan, media, lambda item: root / item.path)
    body = {"fcpxml": fcpxml.to_fcpxml, "xmeml": xmeml.to_xmeml, "edl": edl.to_edl}[fmt](data)
    return body, media_type, ext

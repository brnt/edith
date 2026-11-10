from edith.db.documents import MEDIA, PROJECT_INFO, PROJECT_INFO_ID, MediaItem, ProjectInfo
from edith.export import bundle, common, edl, fcpxml, xmeml
from edith.services import editing
from edith.services.projects import file_stem, open_project, project_folder

FORMATS = {
    "json": ("application/json", "json"),
    "fcpxml": ("application/xml", "fcpxml"),
    "xmeml": ("application/xml", "xml"),
    "edl": ("text/plain", "edl"),
}


def export(slug: str, fmt: str) -> tuple[str, str, str]:
    """(body, media type, suggested file name)."""
    media_type, ext = FORMATS[fmt]
    if fmt == "json":
        with open_project(slug) as project:
            return bundle.to_bundle(slug, project), media_type, f"{file_stem(slug)}.{ext}"
    plan = editing.build_project_plan(slug)
    with open_project(slug) as project:
        media = {
            m.doc_id: m.document
            for m in project.documents_of(MEDIA)
            if isinstance(m.document, MediaItem)
        }
        info = project.get(PROJECT_INFO, PROJECT_INFO_ID)
    name = (
        info.document.name if info and isinstance(info.document, ProjectInfo) else file_stem(slug)
    )
    # Absolute paths of the media: the project folder (on Docker, mounted at the same path as on
    # the host, so these are the editing machine's paths too).
    root = project_folder(slug)
    data = common.ExportInput(name, plan, media, lambda item: root / item.path)
    body = {"fcpxml": fcpxml.to_fcpxml, "xmeml": xmeml.to_xmeml, "edl": edl.to_edl}[fmt](data)
    return body, media_type, f"{file_stem(slug)}.{ext}"

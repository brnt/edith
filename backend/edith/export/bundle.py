"""The Edith project as portable JSON: every document at the version it was stored at."""

import json
from datetime import UTC, datetime

from edith.db.project_file import ProjectFile

FORMAT = "edith-export"
VERSION = 1


def to_bundle(slug: str, project: ProjectFile) -> str:
    return json.dumps(
        {
            "format": FORMAT,
            "version": VERSION,
            "project": slug,
            "exported_at": datetime.now(UTC).isoformat(),
            "documents": project.dump_documents(),
        },
        indent=2,
    )

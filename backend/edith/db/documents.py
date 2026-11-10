"""Versioned documents and the upcasters that read old versions.

The SQLite schema is frozen (see project_file.py); all evolution happens here.
Each document records the version it was written at. Reading upcasts it in memory,
one step at a time, to the current model. Nothing is rewritten until the user saves.

To change a document's shape: bump `current_version`, add an upcaster from the old
version, update the model, and add a fixture project at the old version under
tests/fixtures/ (see docs/adr/0001).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from edith.core.errors import UnsupportedVersion

Upcaster = Callable[[dict[str, Any]], dict[str, Any]]


class Document(BaseModel):
    # Unknown fields survive a round trip, so an older Edith editing a newer-minor
    # file does not silently drop data it does not understand.
    model_config = ConfigDict(extra="allow")


@dataclass(frozen=True)
class DocumentKind:
    name: str
    current_version: int
    model: type[Document]
    # upcasters[v] turns a version-v body into a version-(v+1) body.
    upcasters: dict[int, Upcaster] = field(default_factory=dict)

    def upcast(self, version: int, body: dict[str, Any]) -> Document:
        if version > self.current_version:
            raise UnsupportedVersion(
                f"{self.name} is at version {version}; this Edith reads up to "
                f"{self.current_version}. Update Edith to open it."
            )
        while version < self.current_version:
            try:
                upcaster = self.upcasters[version]
            except KeyError:
                raise ValueError(f"no upcaster for {self.name} v{version}") from None
            body = upcaster(body)
            version += 1
        return self.model.model_validate(body)


class ProjectInfo(Document):
    name: str
    created_at: datetime


PROJECT_INFO = DocumentKind("project_info", 1, ProjectInfo)
PROJECT_INFO_ID = "project"

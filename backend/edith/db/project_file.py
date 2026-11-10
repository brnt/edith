"""One project = one SQLite file holding versioned documents.

The schema is deliberately tiny and frozen: `meta` and `documents`. Anything that
would be a schema change elsewhere is a document version bump here (documents.py).
Opening a project never writes to it; only an explicit `put` on a writable handle does.
"""

import json
import os
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Self

from edith.core.errors import (
    NotAProjectFile,
    ProjectExists,
    ProjectNotFound,
    ReadOnlyProject,
    UnsupportedVersion,
)
from edith.db.documents import Document, DocumentKind

FORMAT = "edith-project"
CONTAINER_VERSION = 1  # the frozen two-table layout below

_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (kind, id)
);
"""


@dataclass(frozen=True)
class LoadedDocument:
    doc_id: str
    document: Document
    stored_version: int
    # True when the file holds an older version than the app writes today. The UI
    # offers to save in the current format; nothing is rewritten automatically.
    needs_upgrade: bool


class ProjectFile:
    def __init__(self, conn: sqlite3.Connection, *, writable: bool) -> None:
        self._conn = conn
        self._writable = writable

    @classmethod
    def create(cls, path: Path) -> Self:
        try:
            os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except FileExistsError:
            raise ProjectExists(str(path)) from None
        conn = sqlite3.connect(path)
        with conn:
            conn.executescript(_SCHEMA)
            conn.executemany(
                "INSERT INTO meta (key, value) VALUES (?, ?)",
                [("format", FORMAT), ("container_version", str(CONTAINER_VERSION))],
            )
        return cls(conn, writable=True)

    @classmethod
    def open(cls, path: Path, *, writable: bool = False) -> Self:
        if not path.is_file():
            raise ProjectNotFound(str(path))
        mode = "rw" if writable else "ro"
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode={mode}", uri=True)
        try:
            meta = dict(conn.execute("SELECT key, value FROM meta"))
        except sqlite3.DatabaseError:
            conn.close()
            raise NotAProjectFile(str(path)) from None
        if meta.get("format") != FORMAT:
            conn.close()
            raise NotAProjectFile(str(path))
        if int(meta.get("container_version", "0")) > CONTAINER_VERSION:
            conn.close()
            raise UnsupportedVersion(
                f"{path.name} was written by a newer Edith; update to open it."
            )
        return cls(conn, writable=writable)

    def get(self, kind: DocumentKind, doc_id: str) -> LoadedDocument | None:
        row = self._conn.execute(
            "SELECT schema_version, body FROM documents WHERE kind = ? AND id = ?",
            (kind.name, doc_id),
        ).fetchone()
        if row is None:
            return None
        version, body = row
        return LoadedDocument(
            doc_id=doc_id,
            document=kind.upcast(version, json.loads(body)),
            stored_version=version,
            needs_upgrade=version < kind.current_version,
        )

    def list(self, kind: DocumentKind) -> list[LoadedDocument]:
        rows = self._conn.execute(
            "SELECT id, schema_version, body FROM documents WHERE kind = ? ORDER BY id",
            (kind.name,),
        ).fetchall()
        return [
            LoadedDocument(
                doc_id=doc_id,
                document=kind.upcast(version, json.loads(body)),
                stored_version=version,
                needs_upgrade=version < kind.current_version,
            )
            for doc_id, version, body in rows
        ]

    def delete(self, kind: DocumentKind, doc_id: str) -> None:
        if not self._writable:
            raise ReadOnlyProject("project opened read-only")
        with self._conn:
            self._conn.execute(
                "DELETE FROM documents WHERE kind = ? AND id = ?", (kind.name, doc_id)
            )

    def any_older_than_current(self, kinds: Iterable[DocumentKind]) -> bool:
        return any(
            self._conn.execute(
                "SELECT 1 FROM documents WHERE kind = ? AND schema_version < ? LIMIT 1",
                (k.name, k.current_version),
            ).fetchone()
            for k in kinds
        )

    def put(self, kind: DocumentKind, doc_id: str, document: Document) -> None:
        """Write a document at the kind's current version (this is what upgrades it)."""
        if not self._writable:
            raise ReadOnlyProject("project opened read-only")
        with self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO documents (kind, id, schema_version, body) "
                "VALUES (?, ?, ?, ?)",
                (kind.name, doc_id, kind.current_version, document.model_dump_json()),
            )

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

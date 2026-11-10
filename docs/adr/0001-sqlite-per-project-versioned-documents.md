# 0001. SQLite per project, with versioned documents and upcasting

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Edith is a local, single-user tool. A project is a recording session: its media lives on an
external SSD and the project should travel with it. The scaffold default is Postgres +
Alembic, with migrations as an operator step and never on startup. Projects will be opened
long after they were created, by newer versions of the app, and users should not have to run
a migration (or lose the ability to open an old project) to look at one.

## Decision

- Each project is a folder containing `project.edith`, a SQLite file, beside its media.
- The SQLite schema is **frozen**: `meta(key, value)` and
  `documents(kind, id, schema_version, body)`. A `container_version` in `meta` guards the
  layout itself.
- All domain data (project info, media entries and sync results, the edit decision list,
  track settings, stills) are JSON **documents** validated by Pydantic models. Each stores
  the version it was written at.
- Evolution is a version bump plus an **upcaster** (`v → v+1`) per document kind. Reading
  upcasts in memory. **Opening a project never writes to it.** A document is rewritten at the
  current version only when the user edits it; the UI then prompts them to save in the new
  format. A document newer than the app understands is refused (read-only open); unknown
  fields within a version survive a round trip.
- Every version bump ships a fixture project at the old version and a test that loads it.
- The project JSON export is a versioned bundle of the same documents, the portable fallback.

## Alternatives considered

- **Postgres + Alembic (scaffold default)** — a server to run and a volume to lose, no
  portability with the media, and a migration step before an old project can be opened.
  Its strengths (concurrency, network access) don't apply to a single-user local tool.
- **SQLite with normal tables and Alembic migrations** — portable, but old projects need
  migrating in place before use, which contradicts "opening never modifies a project".
- **DuckDB** — built for analytics; edit decisions are small transactional writes. The
  numeric work (sync correlation, silence detection) is numpy/scipy, not SQL.

## Consequences

- No relational constraints or ad hoc SQL over stored state; integrity is enforced in code.
  Acceptable: the data is small.
- Upcasters and fixture projects must be kept forever.
- The scaffold's "no migrations on startup" rule holds trivially; there is no `just migrate`.
- Moving to a hosted, multi-user setup later would mean a new storage backend behind the same
  document interface.

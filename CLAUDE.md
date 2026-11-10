# Edith

Browser-based multicam editor: sync many audio/video files, pick cameras, collapse dead time, insert stills.

## Conventions (from the scaffold meta-repo)

@~/projects/scaffold/conventions/stack.md
@~/projects/scaffold/conventions/coding-standards.md
@~/projects/scaffold/conventions/git-workflow.md
@~/projects/scaffold/conventions/testing.md
@~/projects/scaffold/conventions/logging.md
@~/projects/scaffold/conventions/build.md
@~/projects/scaffold/conventions/deployment.md
@~/projects/scaffold/conventions/documentation.md
@~/projects/scaffold/conventions/decisions.md
@~/projects/scaffold/conventions/lessons.md

## Project-specific notes

**What it is:** a local, single-user, browser-based editor for multicam long-form video. It
ingests video and audio from a recording session, syncs them (registration tone at the start
and end of a take, room-audio correlation as fallback), and lets an editor choose the active
camera, collapse dead time, and drop stills over the video channel (audio continues). Output:
Edith project file → Resolve/Premiere export → in-app ffmpeg render (1080p H.264) later.

**Layout:** `backend/` (FastAPI, package `edith`) and `frontend/` (Preact SPA, talks to `/api/*`).
Root `justfile` delegates to both; Compose runs `api` (:8000) and `web` (:8080).

**Stack deviations in force** (see `docs/adr/`):
- **SQLite per project, no Postgres, no Alembic** ([0001](docs/adr/0001-sqlite-per-project-versioned-documents.md)).
  A project is a folder with `project.edith` (SQLite, frozen two-table schema holding
  versioned JSON documents) beside its media. Schema evolution = document version bump +
  an upcaster in `backend/edith/db/documents.py`. **Opening a project never writes to it**;
  editing an old-format project prompts the user to save in the current format. Never add a
  SQL migration; never rewrite a file on open. Each version bump needs a fixture project
  under `backend/tests/fixtures/` and a test that loads it.
- **ffmpeg runs server-side**, not in the browser ([0002](docs/adr/0002-ffmpeg-on-the-backend.md)).
  The render is a cut-list compiled to an ffmpeg filtergraph and applied to full-res originals;
  the browser previews low-res proxies.
- Convention targets that don't apply: `just migrate` (no schema), Postgres-backed tests (tests
  use a throwaway SQLite file under `tmp_path`).

**Rules specific to this project:**
- **Media is never modified or copied.** Project files reference media by path relative to the
  project folder; the app writes only `project.edith` and the proxy/cache dir.
- Routes are sync `def` (stdlib `sqlite3` is blocking; FastAPI runs them in a threadpool).
- The edit is a non-destructive decision list on one synced timeline (camera switches, cuts
  applied to all feeds, stills); preview and render both derive from it.
- Sync reference: the registration-tone detector in `~/projects/stickshift/audio/registration.py`
  (seeded 32-bit FSK burst, cross-correlation + bit verification). Port it; don't rewrite it.

**Local use:** `LIBRARY_DIR` (root `.env`) is the host folder bind-mounted as the library; point
it at a folder on the external SSD.

## Commands

Prefer the `just` targets (`just` to list): `just init`, `just run` (api :8000 + web :5173),
`just test`, `just test-live` (needs `just up`), `just lint`, `just fmt`, `just up`
(Compose: web :8080, api :8000), `just ci`. There is no `just migrate`.

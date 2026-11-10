# Edith — agent instructions

Browser-based multicam editor: sync many audio/video files, pick cameras, collapse dead time, insert stills.

## Conventions (source of truth)

This project follows the shared conventions in the `scaffold` meta-repo. **Before
writing or changing any code, read these files and follow them:**

- `~/projects/scaffold/conventions/stack.md`
- `~/projects/scaffold/conventions/coding-standards.md`
- `~/projects/scaffold/conventions/git-workflow.md`
- `~/projects/scaffold/conventions/testing.md`
- `~/projects/scaffold/conventions/logging.md`
- `~/projects/scaffold/conventions/build.md`
- `~/projects/scaffold/conventions/deployment.md`
- `~/projects/scaffold/conventions/documentation.md`
- `~/projects/scaffold/conventions/decisions.md`
- `~/projects/scaffold/conventions/lessons.md`

If the scaffold repo lives somewhere other than `~/projects/scaffold`, adjust
these paths.

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
- **Media is never modified or copied.** Paths in documents are relative to the library root and
  validated (no `..`, no absolute); the app writes only `project.edith`, `cache/`, and `renders/`.
- Routes are sync `def` (stdlib `sqlite3` is blocking; FastAPI runs them in a threadpool).
- **The render plan (`edit/plan.py`) is the single source of truth** for what the output is.
  Exporters and the ffmpeg render serialise it; the frontend's `lib/timeline.ts` mirrors its
  rules for the preview. Change the semantics in the plan first, then both.
- All edit times are **shared-timeline seconds before cuts** (earliest file = 0). Source time =
  timeline time minus the file's offset (sync start + nudge). Cuts ripple; the output shows one *channel* (a camera or a still) from each switch until the
  next, and audio continues regardless; camera audio is never used.
- Document kinds live in `db/documents.py`; every shape change is a version bump + upcaster +
  fixture project + test. Saving writes the *current* version; reading never writes.
  **Edit is at v2** (stills became switches; `_edit_v1_to_v2`); the v1 fixture lives in
  `backend/tests/fixtures/projects/` and is exercised by `tests/api/test_old_projects.py`.
- **Channels are numbered cameras-first, then stills, by name, only 1-9** (`channelsOf` in
  `lib/timeline.ts`): this numbering drives the number keys, the ribbon buttons, the timeline row
  badges and the switch list, so change it in one place.
- Long work (proxies, sync, render) runs as a job (`services/jobs.py`); the UI polls `/jobs/{id}`.
- **ffmpeg gotchas learned on real footage:** never loop a still with `-loop 1` as an input inside
  a concat (it stalls); `-ss` before `-i` for every clip; hold stills with the `loop` filter.
  Exports and renders use the *saved* edit, not unsaved UI state.
- **Sync** (`backend/edith/sync/`, try it: `cd backend && uv run python -m edith.sync --template FILE:START:END FILES...`):
  the registration sound is a pluggable *template* (seed, WAV, or an excerpt cut from a
  recording), because what was actually played is not always the generated burst
  ([0003](docs/adr/0003-sync-by-normalized-correlation-and-cross-file-consensus.md)). Never score
  by raw correlation (loud claps beat the quiet tone); never trust one file's best peak. The
  seeded burst generator is a bit-exact port of `~/projects/stickshift/audio/registration.py`
  (its bit-verifying detector fails on recorded audio; don't port it).
- Sample session for real-data checks: `EDITH_SAMPLE_MEDIA=/Volumes/BRENTexp/media uv run pytest
  tests/sync/test_real_media.py` (skipped when unset; the media is ~1.9 GB, never commit it).
- Not built yet: applying measured drift to clip placement, vertical/9:16 reframing, segment-level
  audio gain, and a room-audio sync fallback. Add a fixture project for every future version bump.

**Local use:** `LIBRARY_DIR` (root `.env`) is the host folder bind-mounted as the library; point
it at a folder on the external SSD.

## Commands

Prefer the `just` targets (`just` to list): `just init`, `just run` (api :8000 + web :5173),
`just test`, `just test-live` (needs `just up`), `just lint`, `just fmt`, `just up`
(Compose: web :8080, api :8000), `just ci`. There is no `just migrate`.

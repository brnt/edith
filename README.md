# Edith

A local, browser-based editor for multicam long-form video. Point it at a recording session
(several cameras, three or four audio feeds), and it syncs everything onto one timeline where you
choose the active camera, collapse dead time, and drop in stills while the audio keeps running.
Exports an Edith project file, then (planned) Resolve/Premiere project files and an in-app render.

> **Status:** early. Project create/list/open works end to end (including the versioned
> project-file format), and the sync engine places multi-device recordings on one timeline from
> their registration sounds (command line only). Ingest into projects, the timeline UI, and
> exports are not built yet.

Try the sync engine on a session (needs `ffmpeg`); the registration sound can be a seed, a WAV, or
an excerpt cut from one of the recordings:

```bash
cd backend
uv run python -m edith.sync --template take.wav:13.38:13.62 cam1.mp4 cam2.mp4 take.wav
```

## Stack

Python 3.12+ · FastAPI · Pydantic v2 · SQLite (one file per project) · structlog · `uv` · `ruff` ·
`pytest` · numpy · scipy — Preact · Vite · TypeScript · Tailwind v4 · Vitest · `pnpm` — Docker Compose. `ffmpeg`
for media work. See [docs/adr/](docs/adr/) for why SQLite and why ffmpeg server-side.

## Quick start (Docker)

Requires Docker.

```bash
cp .env.example .env     # optional: set LIBRARY_DIR to a folder on your SSD
just up
```

Web UI: http://localhost:8080 · API docs: http://localhost:8000/docs. Projects are created under
`LIBRARY_DIR` (default `./.library`, gitignored) as `<slug>/project.edith`.

## Development

Requires [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io), [just](https://just.systems),
and [direnv](https://direnv.net). Run `direnv allow` once in `backend/` and `frontend/`; never
activate a virtualenv by hand.

```bash
just init       # install deps + pre-commit hooks
just run        # api on :8000, web dev server on :5173
just test       # backend + frontend suites (no running stack needed)
just lint       # / just fmt
just test-live  # HTTP tests against `just up` (skips if the stack is down; not in CI)
just ci         # lint + test + frontend build
```

## Configuration

Backend variables are in `backend/.env.example`, frontend in `frontend/.env.example`, Compose in
`.env.example`. `API_TOKEN` must match between the API and the web build.

## Architecture

```
backend/edith/   api/ (thin routers, one error map) · core/ (config, logging) ·
                 db/ (project file + versioned documents) · services/ (logic)
frontend/src/    Preact SPA; all HTTP in lib/api.ts
<library>/<slug>/project.edith   SQLite: meta + documents(kind, id, schema_version, body)
```

Opening a project never modifies it. Older document versions are upcast in memory; editing one
prompts a save in the current format ([ADR 0001](docs/adr/0001-sqlite-per-project-versioned-documents.md)).
Media is referenced in place and never modified.

## Deployment

Local only for now: `docker compose build`, then `just up`. There is no database service and no
migration step.

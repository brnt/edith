# Canonical task entrypoint. Run `just` to list recipes.
# Delegates to backend/ and frontend/; recipes are CI-safe (no direnv needed).

set dotenv-load := true

default:
    @just --list

# One-time setup: deps + pre-commit hooks.
init:
    cd backend && uv sync
    cd frontend && pnpm install
    cd backend && uv run pre-commit install --config ../.pre-commit-config.yaml

# Backend (:8000) and frontend dev server (:5173) together.
run:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT
    (cd backend && uv run uvicorn edith.main:app --reload) &
    (cd frontend && pnpm dev) &
    wait

test:
    cd backend && just test
    cd frontend && just test

# HTTP against `just up`. Skips if the stack is down. Not part of `just ci`.
test-live:
    cd backend && just test-live

lint:
    cd backend && just lint
    cd frontend && just lint

fmt:
    cd backend && just fmt
    cd frontend && just fmt

# Web UI on :8080, API on :8000. There is no schema to migrate: project files
# upcast old document versions on read (docs/adr/0001).
up:
    mkdir -p "${LIBRARY_DIR:-.library}"
    HOST_LIBRARY_DIR="$(cd "${LIBRARY_DIR:-.library}" && pwd -P)" docker compose up --build

# Exactly what CI runs.
ci: lint test
    cd frontend && just build

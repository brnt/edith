# Edith

A local, browser-based editor for multicam long-form video. Point it at a recording session
(several cameras, separate audio recorders), tell it what the registration beep sounds like, and
it syncs everything onto one timeline where you pick the active camera, cut dead time, and drop
in stills while the audio keeps running. Output: an Edith project file, FCPXML / Premiere XML /
EDL for finishing elsewhere, or a 1080p H.264 render straight from the app.

> **Status:** working prototype, verified on a real Canon + GoPro + Zoom session. See
> [Known limits](#known-limits).

## Stack

Python 3.12+ · FastAPI · Pydantic v2 · SQLite (one file per project) · numpy/scipy · structlog ·
`uv` · `ruff` · `pytest` — Preact · Vite · TypeScript · Tailwind v4 · Ant Design icons · Vitest · `pnpm` — Docker
Compose. `ffmpeg`/`ffprobe` do all media work server-side
([ADR 0002](docs/adr/0002-ffmpeg-on-the-backend.md)).

## Quick start

Requires Docker.

```bash
cp .env.example .env     # set LIBRARY_DIR to the folder holding your media (e.g. on the SSD)
just up
```

Open http://localhost:8080 (API docs: http://localhost:8000/docs).

`LIBRARY_DIR` is the folder Edith can see: your media can live anywhere inside it, and each
project is created as a sub-folder (`<slug>/project.edith` plus a `cache/` and `renders/`).
Media is referenced in place and never modified or copied.

## How to use it

The video preview and the timeline are always on screen. The tools live in a fixed-height ribbon
above them with four tabs (**Media**, **Sync**, **Edit**, **Export**); it opens on whichever step
comes next.

1. **Media.** Create a project, then **Add media…** and pick the camera, audio, and still-image
   files (each shows a tiny thumbnail). **Build proxies** (low-res copies the browser can scrub;
   originals are untouched). The speaker checkbox beside a file says whether its audio goes into
   the output: audio-only files are on by default, a camera's own audio is off until you tick it.
2. **Sync.** Every device should have recorded a registration sound once shortly after it started
   and once shortly before it stopped. Tell Edith what it sounds like, then **Find the sound in
   every file**. Three ways:
   - **Marked in a recording:** pick any recording that contains it and drag across the sound on
     the waveform (a quiet beep shows as a small bump). Works for any sound, including ones Edith
     didn't generate.
   - **Generated from text:** type the seed string (e.g. `stickshift`); **Download .wav** gives
     you the sound to play on set. Edith searches every file for that same sound.
   - **An audio file:** choose a file from the library (silence around the sound is trimmed). It
     is searched for, not added to the project.

   Each file gets a start offset, a **Match** score (1.0 = identical; real rooms score lower, e.g.
   0.4-0.6), drift, and a result: *synced*, *check* (weak or inconsistent: review it), or *not
   found*. Compare the Match across files: a different seed or the wrong sound can partly match
   and may land up to ~30 ms off, but scores clearly lower. Nudge any file by hand in
   milliseconds.
3. **Edit.** The large view (it grows with the window, up to two thirds of its width on a big screen) plays the synced proxies, with the time and play controls under it. Beside
   it is a grid of every camera (live thumbnails, in step with the playhead) and every still (a
   small picture): **click one to cut to it at the current position**. Each channel keeps its own
   slot in the grid (cameras in number order, then stills); the one on screen is a dimmed live copy with an "on screen" overlay
   (not clickable), so switching never shuffles the tiles. The timeline shows each camera, the stills, and each audio track's waveform.
   - **Channels:** the output shows one *channel* at a time: a camera or a still. Cameras are
     numbered first, then stills (each by name), and only the first nine get a number. Put the
     playhead where you want the change and press the channel's number (or click its button);
     it stays on screen until the next switch, so a still is cut to and from like a camera.
     **With a range selected** (drag on the timeline), clicking a thumbnail or pressing a number
     shows that channel over just the range, then goes back to whatever was showing at its end (a
     cutaway); the selection then clears. `Esc` clears a selection without doing anything.
     The eye switch beside each file in the **Media** tab hides a camera or still from the grid:
     it loses its number (the rest close up), is dimmed on the timeline, and isn't decoded
     unless it is on screen. It only tidies your workspace; the rendered output never changes.
   - **Dead time:** *Find* outlines silent stretches (all output tracks quiet) and always
     includes the registration sounds, which are sync marks and not content (it cuts them even
     when speech follows right after). *Cut all*, or drag-select and press `x` to cut by hand.
     Cuts ripple.
   - **Selecting on the timeline:** click a channel's **segment** (a blue or teal block: one
     stretch where that channel is on screen) or a **cut** to select it (it glows white).
     Clicking anywhere else still moves the playhead; `Esc` deselects.
     - **Resize:** drag a selected item's edges. Grip marks inside a segment's ends show which
       edges can move. Moving a segment's edge moves the neighbouring segment's edge with it, and
       it can't pass the next one. A cut's edges set where it starts and ends (the first and last
       cuts set the start and end of the final clip).
     - **While you drag,** the playhead follows the edge and the preview shows the edit as it
       would be if you dropped it now. At a boundary between two **videos** the grid steps aside
       and the two are shown side by side, in timeline order: the last frame before the boundary
       on the left, the first frame after it on the right. Between a **video and a still**, the
       video is shown (its frame at the boundary); between two **stills**, the one being resized.
       A readout shows the time, and one drag is one undo step.
     - **Delete:** `Delete` removes the selected item. Deleting a segment lets the one before it
       carry on.
   - **Stills:** a still is a channel: cut to it from the grid or its number key, and cut away
     again the same way. The audio always continues.
   - **Audio:** each included file gets a track on the timeline with an overall gain slider. To
     change the level over just a stretch, drag-select it, pick the track under **Mix the
     selection**, and press **Set** (a dB change added to the track) or **Mute**. It shows on the
     track as an amber (gain) or red (muted) band; a new one paints over what it overlaps. The
     **Mix** menu lists them. Mixing is part of the edit, so it reaches the preview, the exports
     and the render.
   - **Range:** `i` / `o` set the in and out points.
   - **Edit list:** the Switches and Cuts menus list every decision; click one to jump to it, ✕
     to remove it.
   - **Save** (⌘/Ctrl+S) writes the edit into the project file. Undo/redo with ⌘/Ctrl+Z.
4. **Export.** FCPXML (DaVinci Resolve, Final Cut), Premiere XML, EDL (video only), the Edith
   JSON, or **Render MP4 (1080p)**. Exports and renders use the *saved* edit.

Keys: `space` play · `1`–`9` camera or still · `x` cut selection · `i`/`o` range · `←`/`→` step (shift = 10 s).

## Development

Requires [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io), [just](https://just.systems),
[direnv](https://direnv.net) and `ffmpeg` on the host. Run `direnv allow` once in `backend/` and
`frontend/`; never activate a virtualenv by hand.

```bash
just init       # install deps + pre-commit hooks
just run        # api on :8000, web dev server on :5173
just test       # backend + frontend suites (no running stack needed)
just lint       # / just fmt
just test-live  # HTTP tests against `just up` (skips if the stack is down; not in CI)
just ci         # lint + test + frontend build
```

For local development, point `LIBRARY_DIR` in `backend/.env` at a folder of media. Backend tests
that need real media generate tiny synthetic files with ffmpeg. To also check the real sample
session: `EDITH_SAMPLE_MEDIA=/path/to/session uv run pytest tests/sync/test_real_media.py`.

The sync engine alone, from the command line:

```bash
cd backend
uv run python -m edith.sync --template take.wav:13.38:13.62 cam1.mp4 cam2.mp4 take.wav
```

## Configuration

Backend variables are in `backend/.env.example`, frontend in `frontend/.env.example`, Compose in
`.env.example`. `API_TOKEN` must match between the API and the web build. `HOST_LIBRARY_DIR` is
set for you by `just up`; exports use it so file paths point at the real files.

## Architecture

```
backend/edith/
  api/        thin routers; one place maps domain errors to HTTP statuses
  core/       config, logging, auth, errors
  db/         project file (SQLite) + versioned documents with upcasters
  sync/       registration-sound search, cross-file solver, ffmpeg access
  edit/       render plan builder (the single source of truth), silence detection
  export/     FCPXML, xmeml, EDL, JSON bundle, ffmpeg render command
  services/   project/media/proxy/peaks/sync/edit/export/render logic, background jobs
frontend/src/ Preact SPA; all HTTP in lib/api.ts; timeline math in lib/timeline.ts (mirrors the plan)
```

- **Project file.** `project.edith` is SQLite with a frozen two-table schema holding versioned
  JSON documents (project info, media, sync state, the edit). Older documents are upcast in memory
  when read; **opening never modifies a project**, and saving rewrites at the current version
  ([ADR 0001](docs/adr/0001-sqlite-per-project-versioned-documents.md)).
- **Sync.** Energy-normalised correlation against a template of the registration sound, then a
  cross-file solver that rejects loud lookalikes
  ([ADR 0003](docs/adr/0003-sync-by-normalized-correlation-and-cross-file-consensus.md)).
- **The edit** is a non-destructive list on the shared timeline (channel switches, cuts, track
  settings, range). A still is a channel like a camera. `edit/plan.py` turns it into concrete clips; preview mirrors it, every
  export serialises it, and the render compiles it to one ffmpeg command.

## Known limits

- **Resolve / Premiere exports are untested in those apps.** They are structurally validated
  (well-formed, references resolve, frame-exact times) but have not been opened in Resolve,
  Premiere, or Final Cut. Expect to report and fix quirks on first import.
- **Drift is measured but not applied.** Each file's clock drift (ppm) is shown; clips are placed
  from the start offset only. Over a very long take, a drifting device would slowly slide.
- **One camera showed a 22 ms inconsistency** between its start and end tone on the sample
  session; sync flags weak or inconsistent files as *check*. Long real takes will tell whether it
  is a mis-located peak or real clock drift.
- **Preview is proxy quality** and plays with a wall clock, so scrubbing and cut jumps can
  briefly stutter; the render is the source of truth.
- **Single user, single machine.** Background jobs live in memory; a restart forgets running jobs
  (their results are on disk).
- Stills must be JPEG/PNG/WebP. No vertical (9:16) output yet: the plan carries width and height
  but there is no per-camera reframing.

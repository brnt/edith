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
cp .env.example .env     # optional: set EDITH_MOUNT (default: your home folder; /Volumes for drives)
just up
```

Open http://localhost:8080 (API docs: http://localhost:8000/docs).

**A project is a `.edith` file in a folder**, anywhere on your machine, next to the media you shoot (`project.edith` for the first project in a folder, then `<name>.edith`),
`renders/`, and a hidden `.edith/` cache (proxies, thumbnails). Nothing else holds project state, so
you can move or copy the folder to another drive or computer and open it there
([ADR 0004](docs/adr/0004-projects-are-self-contained-folders.md)). Media is never modified or
copied. Under Docker, `EDITH_MOUNT` is the part of your machine Edith can see; it is mounted at the
same path as on your machine, so the file paths in exports are your real ones. Edith remembers the
projects you open in a recent list (`~/.edith`, or the `state` volume in Docker); there is no
library and nothing to scan.

## How to use it

The video preview and the timeline are always on screen. The tools live in a fixed-height ribbon
above them with four tabs (**Media**, **Sync**, **Edit**, **Export**); it opens on whichever step
comes next.

1. **Start.** The start page lists your recent projects and has **New project…** and **Open
   project…**. To create one, pick the folder that holds the media, in a picker laid out like the macOS
   Finder's (places and drives on the left, back and forward, the path on top with every folder in
   it a link, double-click to go inside), make one with **New Folder** if you need it. The project is named
   as you type, or after the folder you choose if you leave the name empty. A folder that already has a project can hold another (two cuts of one shoot, say): the
   picker lists what is there (its projects, and the media files Edith can use, greyed, so you can tell you are in the folder you meant), and the new project, numbered if it would share a name, is saved beside
   it and shares the media, the preview cache and the `renders/` folder (each project lists only its own renders). To open one, select its
   `.edith` file, or the folder that has just one, and press Open. Clicking outside a dialog
   dismisses it. A project's address is a short random id, not its path. A folder can hold several
   projects (say two cuts of one shoot): they share the media, and each is its own `.edith` file. A project whose file can't be
   found right now (an unplugged drive) is simply not listed, and is back when the drive is. **Remove
   from list** takes a project off for good (only the list entry goes, never anything on disk).
2. **Media.** Put the camera, audio and still-image files in the project folder (subfolders are
   fine: the media view keeps your folder hierarchy) and they turn up in the **Media** tab by
   themselves within a few seconds. There is no _Add media_ and no _Remove_: the folder is the way
   in and out. Footage kept elsewhere (an external drive) can be linked into the folder. A file
   that is deleted from the folder and that nothing in the edit uses simply disappears from the
   list.
   Each file is a card: a thumbnail (a waveform for audio) with its name, the grid number it has,
   a sync icon for video and audio (green check synced, amber exclamation check, red cross not
   found, grey arrows not synced yet), and:
   - **Include:** a file found in the folder is marked _new_ and is **not part of the project**
     until you include it (tick its checkbox). Looking never writes to the project; including is the
     edit that does. The tab shows how many are waiting.
   - **The checkbox:** ticked by default. For a camera or still it shows or hides it in the grid
     and the timeline (a hidden one stays on the timeline only while a segment still shows it). For
     an audio file it is the single control for whether its sound is in the output. Ticking a
     _new_ file includes it in the project.
   - **Cameras, stills and audio** are told apart by an icon and a tint on the name chip, and
     by the colour of the number chip (blue cameras, teal stills).
   - **The speaker (cameras):** whether the camera's own audio is used, independent of the
     checkbox (off until you turn it on, shown as a crossed-out speaker).
   - **Details (i):** codec, resolution (flagged when it is smaller than the project's output, since it would be scaled up and look soft), frame rate (flagged when variable or different from the
     project's), colour depth, bit rate, audio format, size (the
     file itself is never touched).
   - **Folders:** the cards are grouped by folder, and a folder's header can be folded away,
     **Include all** its new files, or **Exclude all / Show all** its files at once. A **Show**
     filter narrows the cards to cameras, audio, stills, new files, or files the sync hasn't
     placed.
   - **Heads-up marks:** an amber warning button on a card (click it for the details) means a frame rate that differs from the
     project's, or a portrait (vertical) picture; the details say which. They also say how many
     segments of the edit show a camera or still.
   - **Missing files:** if a file goes missing (moved, or its drive unplugged) its card says so
     and it stays in the project. If a file with the same name and length turns up in the folder,
     **Use found file** relinks to it in one click (or choose **Relink…**): every reference in
     the edit and the sync results follows, and it isn't counted as a change. The channel
     tiles and timeline rows (cameras, stills, audio) of a missing file wear a red warning icon
     too; click it to jump to the Media tab.
   - **Registration sound:** an audio file's details have **Use as the registration sound**, the
     same as the Sync tab's "An audio file".
   - **Previews** (low-res copies the browser can scrub; originals are untouched) are made in the
     background as soon as media is found, the project's own media first: a spinner on a card and
     "Preparing previews" in the tab show progress. There is nothing to build by hand. A file that goes missing (moved, or its
     drive unplugged) is marked on its card and stays in the project.
3. **Sync.** Every device should have recorded a registration sound once shortly after it started
   and once shortly before it stopped. Tell Edith what it sounds like, then **Find the sound in
   every file** (the file-search icon, at the end of the first row). Three ways:
   - **Marked in a recording:** pick any recording that contains it and drag across the sound on
     the waveform (a quiet beep shows as a small bump). Works for any sound, including ones Edith
     didn't generate. The waveform shows the first two minutes of the recording,
     fitted to the panel (the zoom buttons beside it, in above out, magnify it, staying centred on the playhead, or on the marked stretch). Edith reads the stretch back: a registration sound
     it generated carries a 32-bit code, so it says whether one is there (and its code) and marks
     where the burst starts, and trims your selection to exactly the burst, so a rough drag is
     enough; a different sound, say an older beep, reads as "not found". To check
     you marked the right stretch by ear, **play the whole recording** or **just
     the selection** (the two play buttons by the zoom buttons; a white line follows the sound, and
     pressing the button again stops it).
   - **Generated from text:** type the seed string (e.g. `stickshift`); when you press Enter or leave the field, Edith
     searches every recording for it at once (once per seed); press Enter, or the download icon,
     to save the sound to play on set (as `<seed>.wav`). The seed is a setting of the project: typing it
     marks the project modified (Save keeps it, Undo takes it back), and Find needs no file to be uploaded. Edith searches every file for that same sound.
   - **An audio file:** choose an audio file from the project folder (silence around the sound is
     trimmed). It is searched for, not added to the project.

   Each file gets a start offset, a **Match** score (1.0 = identical; real rooms score lower, e.g.
   0.4-0.6), drift, and a result: _synced_, _check_ (weak or inconsistent: review it), or _not
   found_. Compare the Match across files: a different seed or the wrong sound can partly match
   and may land up to ~30 ms off, but scores clearly lower. Nudge any file by hand in
   milliseconds.

4. **Edit.** The large view plays the synced proxies, with the time and play controls under it. Beside
   it is a grid of every camera (live thumbnails, in step with the playhead) and every still (a
   small picture): **click one to cut to it at the current position**. The grid is laid out like a **10-key**: 1 2 3 on the bottom row, 4 5 6 above, 7 8 9 on top (rows nobody uses are left out), so a channel's number key is where its thumbnail is and you can cut without looking. Each channel keeps its own cell; the one on screen is a dimmed live copy with an "on screen" overlay
   (not clickable), so switching never shuffles the tiles. The timeline shows each camera, the stills, and each audio track's waveform.
   **Vertical space is shared with the view first:** the large view takes as much as it can use
   (up to two thirds of the window's width), and the timeline gets what is left. It scrolls inside
   itself when its rows don't fit, but never shrinks below about four rows. So adding files
   never shrinks a view that is at full size, and a project with few files has a short timeline.
   When the timeline does scroll, the time ruler and the row labels stay pinned.
   - **Channels:** the output shows one _channel_ at a time: a camera or a still. Cameras are
     numbered first, then stills (each in the order added), and only the first nine get a number. Put the
     playhead where you want the change and press the channel's number (or click its button);
     it stays on screen until the next switch, so a still is cut to and from like a camera.
     **With a stretch selected** (drag on the timeline), clicking a thumbnail or pressing a number
     shows that channel over just the range, then goes back to whatever was showing at its end (a
     cutaway); the selection then clears. `Esc` clears a selection without doing anything.
     The checkbox beside each file in the **Media** tab hides a camera or still from the grid:
     it loses its number (the rest close up), is dimmed on the timeline, and isn't decoded
     unless it is on screen. It only tidies your workspace; the rendered output never changes.
   - **Dead time:** _Find_ outlines silent stretches (all output tracks quiet), within the
     selection if there is one, and always
     includes the registration sounds, which are sync marks and not content (it cuts them even
     when speech follows right after). _Cut all_, or drag-select and press `x` to cut by hand.
     Cuts ripple.
   - **Selecting on the timeline:** click a channel's **segment** (a blue or teal block: one
     stretch where that channel is on screen) or a **cut** to select it (it gets a faint diagonal stripe texture).
     Every click on the timeline moves the playhead to the clicked moment; on a segment or a cut it
     also selects it, and on anything else it deselects. `Esc` deselects.
     - **Resize:** drag a selected item's edges. Light grip marks inside a segment's or cut's ends
       show which edges can move. Moving a segment's edge moves the neighbouring segment's edge with it, and
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
     change the level over just a stretch, drag-select it, pick the track in the **Selection**
     panel, and drag its level slider (a dB change added to the track, set when you let go) or press
     **Mute** (pressed again, **Unmute**). The slider is the level the stretch plays at: it starts at the track's own gain (as set on the timeline) and shows what the stretch is currently set to (the stored change is relative to the track); the
     track, slider and Mute are off until something is selected. It shows on the
     track as an amber (gain) or red (muted) band; a new one paints over what it overlaps. Click a
     band to select it: drag its edges to move them (they paint over a neighbour), change its level
     with the Selection panel's slider or Mute, and press Delete to remove it. Sliders show a tick
     at 0 dB. The
     **Mix** menu lists them. Mixing is part of the edit, so it reaches the preview, the exports
     and the render.
   - **Selection:** drag on the timeline to select a stretch (click away or Esc to drop it). Its
     two edges are handles for fine adjustment: click one to select it, drag it, or nudge it with
     ←/→ (same steps as the playhead, see Keys). Then **Cut** it (x), or **Uncut** it to take it back out of a cut
     block (a block it falls inside is split in two). The final video is always the whole timeline
     minus the cuts, so to export a narrower slice, cut the rest.
   - **Edit list:** the Switches and Cuts menus list every decision; click one to jump to it, ✕
     to remove it.
   - **Save** (⌘/Ctrl+S) writes the edit into the project file. Undo/redo with ⌘/Ctrl+Z.
5. **Export.** FCPXML (DaVinci Resolve, Final Cut), Premiere XML, EDL (video only), the Edith
   JSON (four buttons on the Export tab), or **Render MP4**. Exports and renders use the _saved_ edit. The **Project** panel on that tab sets what they use: the picture size (type any width and height, kept even, or pick a common size), the frame rate (1920×1080 at 29.97 fps by default) and the render's output format (H.264 or H.265 in an MP4, or ProRes 422 HQ in a MOV for finishing in another editor). They are part of the edit, so save before exporting. A file smaller than the chosen size is flagged on its media card, and the panel warns when one that the export actually uses (shown by a segment, not cut out) would be scaled up.

Keys: `space` play · `1`–`9` camera or still · `x` cut selection · `←`/`→` step the playhead, or a selected handle: 1 s, with **Cmd** 10 s, **Option** 0.1 s, **Ctrl** one frame (the modifiers run in order of size along the keyboard's bottom row, smaller to the left).

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

For local development, `just run` needs nothing set: create or open projects from the start page.
(`STATE_DIR` in `backend/.env` moves the recent list; `LEGACY_LIBRARY_DIR` imports projects from
before they were folders, once.) Backend tests that need real media generate tiny synthetic files with ffmpeg. To also check the real sample
session: `EDITH_SAMPLE_MEDIA=/path/to/session uv run pytest tests/sync/test_real_media.py`.

The sync engine alone, from the command line:

```bash
cd backend
uv run python -m edith.sync --template take.wav:13.38:13.62 cam1.mp4 cam2.mp4 take.wav
```

## Configuration

Backend variables are in `backend/.env.example`, frontend in `frontend/.env.example`, Compose in
`.env.example`. `API_TOKEN` must match between the API and the web build. Edith is a local,
single-user tool: the API can browse and read any folder the server can (that is how you pick a
project's folder), so keep it on localhost.

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
  settings). A still is a channel like a camera. `edit/plan.py` turns it into concrete clips; preview mirrors it, every
  export serialises it, and the render compiles it to one ffmpeg command.

## Known limits

- **Resolve / Premiere exports are untested in those apps.** They are structurally validated
  (well-formed, references resolve, frame-exact times) but have not been opened in Resolve,
  Premiere, or Final Cut. Expect to report and fix quirks on first import.
- **Drift is measured but not applied.** Each file's clock drift (ppm) is shown; clips are placed
  from the start offset only. Over a very long take, a drifting device would slowly slide.
- **One camera showed a 22 ms inconsistency** between its start and end tone on the sample
  session; sync flags weak or inconsistent files as _check_. Long real takes will tell whether it
  is a mis-located peak or real clock drift.
- **Preview is proxy quality** and plays with a wall clock, so scrubbing and cut jumps can
  briefly stutter; the render is the source of truth.
- **Single user, single machine.** Background jobs live in memory; a restart forgets running jobs
  (their results are on disk).
- Stills must be JPEG/PNG/WebP. No vertical (9:16) output yet: the plan carries width and height
  but there is no per-camera reframing.

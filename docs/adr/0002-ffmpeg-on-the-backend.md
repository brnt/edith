# 0002. Run ffmpeg on the backend, not in the browser

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Sessions have several cameras (Canon, Sony, GoPros, sometimes a drone) plus three or four
audio feeds, often 4K and long. The editor must scrub quickly and eventually render a 1080p
H.264 episode.

## Decision

The backend owns media work with `ffmpeg`/`ffprobe`: probing, audio extraction for sync,
proxy generation, and final render. The browser edits against low-resolution proxies served
by the backend. The render compiles the edit decision list to an ffmpeg filtergraph applied
to the full-resolution originals. The backend runs locally via Compose with the media folder
bind-mounted.

## Alternatives considered

- **ffmpeg.wasm / WebCodecs in the browser** — multi-GB 4K inputs and long takes exceed what a
  tab can hold or encode in reasonable time, and the browser can't read a mounted SSD
  without uploading or the File System Access API.

## Consequences

- The app needs a local backend process and `ffmpeg` on the host (or in the image).
- Preview fidelity is proxy-quality; the render is the source of truth.
- Hosting it for others later is possible without changing the model, but would need auth and
  upload handling.

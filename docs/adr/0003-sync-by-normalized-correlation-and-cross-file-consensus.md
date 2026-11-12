# 0003. Sync by normalised correlation and cross-file consensus

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Each device records a registration sound shortly after starting and shortly before stopping.
Testing on a real three-device session (Canon, GoPro, Zoom recorder) showed:

- The original tinker detector (bit-pattern verification) returned nothing on every
  speaker-to-mic recording.
- Raw cross-correlation ranked loud claps in the content above the quiet real tone; the
  strongest peak in one camera file was not the registration sound at all.
- The sound that was actually played was _not_ the seeded 600/5500 Hz FSK burst. It was found
  by cutting an excerpt from one recording and searching the others.
- Devices differ in sample rate (44.1/48 kHz) and frame rate; embedded timecodes are unrelated.

## Decision

- The registration sound is a **template**: a seed, a WAV file, or an excerpt of a recording.
- Candidates are scored by **energy-normalised cross-correlation** (0..1), so a quiet exact
  match outranks a loud lookalike. Digital silence is floored so it cannot invent matches.
- A **solver** (pure functions, `sync/solver.py`) never trusts one file's best peak. It forms
  (start, end) candidate pairs per file, finds the interval most files can explain, and takes
  each file's strongest pair at that interval. Bursts closer than 5 s are one event.
- Output per file: start offset on a shared timeline, drift (ppm) relative to the group,
  tone times, score, interval residual, and a status of `synced`, `low_confidence` or
  `unsynced`. Offsets are seconds, not frames.
- Audio is analysed at one rate (44.1 kHz mono) via ffmpeg, only in the first and last
  10 minutes of each file.

## Alternatives considered

- **Port the original detector** — fails on recorded audio.
- **Room-audio cross-correlation as primary** — very strong when all devices share one room
  mix (it was on the sample), but one-mic-per-presenter files will not. Planned as a fallback.
- **Embedded timecodes** — present but unsynchronised between devices.

## Consequences

- Needs the user to supply the sound that was played (or mark an excerpt); the UI should make
  this a click on a waveform.
- Interval agreement allows ~1000 ppm of clock drift; a larger mismatch is reported as
  low-confidence (likely a mis-located peak), which is what the Canon's 22 ms over 39 s does
  to be reviewed rather than silently trusted.
- A tone repeated by a device within 5 s is treated as one event; real takes are far longer.

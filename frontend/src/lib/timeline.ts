// Pure timeline logic. Mirrors backend/edith/edit/plan.py so the preview agrees with exports.
import type { CameraSwitch, Cut, EditList, MediaItem, Still, SyncState } from "./api";

export const EPS = 1e-6;
export type Range = [number, number];

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([a, b]) => b - a > EPS).sort((x, y) => x[0] - y[0]);
  const merged: Range[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + EPS) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function keepIntervals(lo: number, hi: number, cuts: Range[]): Range[] {
  const keep: Range[] = [];
  let cursor = lo;
  for (const [start, end] of mergeRanges(cuts)) {
    if (end <= cursor || start >= hi) continue;
    if (start - cursor > EPS) keep.push([cursor, Math.min(start, hi)]);
    cursor = Math.max(cursor, end);
  }
  if (hi - cursor > EPS) keep.push([cursor, hi]);
  return keep;
}

export const cutRanges = (cuts: Cut[]): Range[] => cuts.map((c) => [c.start_s, c.end_s]);

/** Output time of a timeline time (cuts ripple). Times inside a cut map to the cut's start. */
export function timelineToOutput(t: number, keeps: Range[]): number {
  let out = 0;
  for (const [a, b] of keeps) {
    if (t < a) return out;
    if (t < b) return out + (t - a);
    out += b - a;
  }
  return out;
}

export function outputToTimeline(out: number, keeps: Range[]): number {
  let remaining = out;
  for (const [a, b] of keeps) {
    if (remaining <= b - a) return a + remaining;
    remaining -= b - a;
  }
  return keeps.length ? keeps[keeps.length - 1][1] : 0;
}

/** Where playback should be: `t` itself, or the end of the cut that contains it. */
export function skipCuts(t: number, keeps: Range[]): number {
  for (const [a, b] of keeps) {
    if (t < a) return a;
    if (t < b) return t;
  }
  return keeps.length ? keeps[keeps.length - 1][1] : t;
}

export function mediaOffsets(media: MediaItem[], sync: SyncState | null): Record<string, number> {
  const offsets: Record<string, number> = {};
  for (const m of media) {
    if (m.kind === "image") continue;
    const result = sync?.results[m.id];
    const base =
      result && result.status !== "unsynced" && result.start_s !== null ? result.start_s : 0;
    offsets[m.id] = base + (sync?.nudges[m.id] ?? 0);
  }
  return offsets;
}

export function timelineEnd(media: MediaItem[], offsets: Record<string, number>): number {
  return Math.max(
    0,
    ...media.filter((m) => m.id in offsets).map((m) => offsets[m.id] + (m.duration_s ?? 0)),
  );
}

export function defaultCamera(media: MediaItem[], offsets: Record<string, number>): string | null {
  const cameras = media
    .filter((m) => m.kind === "video")
    .sort((a, b) => offsets[a.id] - offsets[b.id] || a.label.localeCompare(b.label));
  return cameras[0]?.id ?? null;
}

export function activeCamera(
  switches: CameraSwitch[],
  t: number,
  fallback: string | null,
): string | null {
  let current = fallback;
  for (const s of [...switches].sort((a, b) => a.at_s - b.at_s)) {
    if (s.at_s <= t + EPS) current = s.media_id;
  }
  return current;
}

export function stillAt(stills: Still[], t: number): Still | null {
  const covering = stills.filter((s) => s.start_s <= t + EPS && t + EPS < s.end_s);
  return covering.sort((a, b) => b.start_s - a.start_s)[0] ?? null;
}

/** Audio that reaches the output: explicit track settings, else every audio-only file. */
export function effectiveTracks(
  edit: EditList,
  media: MediaItem[],
): { media_id: string; gain_db: number; muted: boolean }[] {
  const byId = new Map(media.map((m) => [m.id, m]));
  if (edit.tracks.length) return edit.tracks.filter((t) => byId.get(t.media_id)?.has_audio);
  const audioOnly = media.filter((m) => m.kind === "audio");
  const chosen = audioOnly.length
    ? audioOnly
    : media.filter((m) => m.kind === "video" && m.has_audio).slice(0, 1);
  return chosen.map((m) => ({ media_id: m.id, gain_db: 0, muted: false }));
}

export interface FrameState {
  camera: string | null;
  still: Still | null;
  /** Local (file) time for every av media, or null when the file has no footage at `t`. */
  local: Record<string, number | null>;
}

export function frameState(
  t: number,
  edit: EditList,
  media: MediaItem[],
  offsets: Record<string, number>,
): FrameState {
  const local: Record<string, number | null> = {};
  for (const m of media) {
    if (m.kind === "image") continue;
    const at = t - offsets[m.id];
    local[m.id] = at >= 0 && at <= (m.duration_s ?? 0) ? at : null;
  }
  return {
    camera: activeCamera(edit.switches, t, defaultCamera(media, offsets)),
    still: stillAt(edit.stills, t),
    local,
  };
}

/** Stretches of the timeline during which `cameraId` is the active camera. */
export function cameraSpans(
  switches: CameraSwitch[],
  cameraId: string,
  fallback: string | null,
  lo: number,
  hi: number,
): Range[] {
  const spans: Range[] = [];
  let current = fallback;
  let from = lo;
  const ordered = [...switches]
    .filter((s) => s.at_s > lo && s.at_s < hi)
    .sort((a, b) => a.at_s - b.at_s);
  for (const s of ordered) {
    if (current === cameraId) spans.push([from, s.at_s]);
    current = s.media_id;
    from = s.at_s;
  }
  if (current === cameraId) spans.push([from, hi]);
  return spans;
}

const KIND_ORDER = { video: 0, audio: 1, image: 2 } as const;

/** Stable order for the UI: cameras first, then audio, then stills; by name within each. */
export function sortMedia(media: MediaItem[]): MediaItem[] {
  return [...media].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label),
  );
}

export function formatTime(seconds: number, frac = 1): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(frac).padStart(frac ? 3 + frac : 2, "0");
  return `${m}:${rest}`;
}

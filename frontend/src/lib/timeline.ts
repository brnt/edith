// Pure timeline logic. Mirrors backend/edith/edit/plan.py so the preview agrees with exports.
import type { CameraSwitch, Cut, EditList, MediaItem, SyncState } from "./api";

export const EPS = 1e-6;
export const TIMELINE_LABEL_W = 176;
const DEFAULT_PX_PER_SEC = 20;
const TIMELINE_BORDER = 2; // the timeline box's own left and right borders

/** Pixels per second that make a timeline of `end` seconds fill `containerWidth`. */
export function fitPxPerSec(containerWidth: number, end: number): number {
  if (containerWidth <= TIMELINE_LABEL_W || end <= 0) return DEFAULT_PX_PER_SEC;
  return (containerWidth - TIMELINE_BORDER - TIMELINE_LABEL_W) / end;
}
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

/** The first moment that is kept: where the playhead starts (a leading cut is skipped). */
export function firstKeptMoment(keeps: Range[], lo: number): number {
  return keeps.length ? keeps[0][0] : lo;
}

/** The last moment that is kept: where playback ends (a trailing cut is never played). */
export function playbackEnd(keeps: Range[]): number {
  return keeps.length ? keeps[keeps.length - 1][1] : 0;
}

/** Move the playhead forward by `dt`, jumping cuts, and say when there is nothing left to play. */
export function advancePlayhead(
  t: number,
  dt: number,
  keeps: Range[],
): { t: number; ended: boolean } {
  const end = playbackEnd(keeps);
  const next = t + dt;
  if (next >= end) return { t: end, ended: true };
  return { t: skipCuts(next, keeps), ended: false };
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

/** The camera or still the output shows at `t`. A null switch means the default camera. */
export function activeChannel(
  switches: CameraSwitch[],
  t: number,
  fallback: string | null,
): string | null {
  let current = fallback;
  for (const s of [...switches].sort((a, b) => a.at_s - b.at_s)) {
    if (s.at_s <= t + EPS) current = s.media_id ?? fallback;
  }
  return current;
}

export const MAX_NUMBERED_CHANNELS = 9;

export interface Channel {
  item: MediaItem;
  /** 1-9 for the first nine enabled channels (the number key), null beyond that or when disabled. */
  number: number | null;
  /** False when switched off in the Media tab: not in the grid, no number, not decoded. */
  enabled: boolean;
}

/**
 * Everything the output can show: cameras first and then stills (each by name). Numbers go to the
 * first nine *enabled* channels, so they always match what the grid shows.
 */
export function channelsOf(media: MediaItem[], disabled: string[] = []): Channel[] {
  const byName = (a: MediaItem, b: MediaItem) => a.label.localeCompare(b.label);
  const off = new Set(disabled);
  const ordered = [
    ...media.filter((m) => m.kind === "video").sort(byName),
    ...media.filter((m) => m.kind === "image").sort(byName),
  ];
  let next = 0;
  return ordered.map((item) => {
    const enabled = !off.has(item.id);
    const number = enabled && next < MAX_NUMBERED_CHANNELS ? ++next : null;
    return { item, number, enabled };
  });
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

/** Does this file's audio go into the output? (Present in the track list and not muted.) */
export function trackIncluded(edit: EditList, media: MediaItem[], mediaId: string): boolean {
  const track = effectiveTracks(edit, media).find((t) => t.media_id === mediaId);
  return track !== undefined && !track.muted;
}

/** A track's level at `t` in dB (its own gain plus any mix region), or null when it is silent. */
export function trackGainDb(
  edit: EditList,
  media: MediaItem[],
  mediaId: string,
  t: number,
): number | null {
  const track = effectiveTracks(edit, media).find((x) => x.media_id === mediaId);
  if (!track || track.muted) return null;
  const covering = edit.mix.filter((r) => r.media_id === mediaId && r.start_s <= t && t < r.end_s);
  const region = covering[covering.length - 1]; // where regions overlap, the later one wins
  if (region?.muted) return null;
  return track.gain_db + (region?.gain_db ?? 0);
}

export interface FrameState {
  /** The camera or still on screen. */
  channel: string | null;
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
  return { channel: activeChannel(edit.switches, t, defaultCamera(media, offsets)), local };
}

export const MIN_SEGMENT_S = 0.1; // a dragged edge cannot squeeze a segment below this

/** Two videos shown side by side while the boundary between them is dragged. */
export interface Compare {
  before: string;
  after: string;
  /** When each is shown: the last frame before the boundary, the first frame after it. */
  tBefore: number;
  tAfter: number;
}

/** What the preview shows while an edge is dragged: the edit as it would be dropped now. */
export interface Preview {
  edit: EditList;
  compare: Compare | null;
}

/**
 * Where the playhead goes, and whether to compare two videos, while the boundary at `at` between
 * the segment `before` and the segment `after` is dragged:
 * - two different videos: both, side by side (before on the left), at the frames either side;
 * - a video next to a still: the video (its frame at the boundary);
 * - otherwise (two stills): the one being resized (`resizing`).
 * At the boundary itself the playhead is on the first frame of what follows it, or one frame earlier
 * (`frameS`) to show the last frame of what precedes it.
 */
export function boundaryPreview(args: {
  before: string | null;
  after: string | null;
  at: number;
  resizing: "before" | "after";
  isVideo: (id: string) => boolean;
  frameS: number;
}): { t: number; compare: Compare | null } {
  const { before, after, at, resizing, isVideo, frameS } = args;
  const last = Math.max(0, at - frameS);
  const videoBefore = before !== null && isVideo(before);
  const videoAfter = after !== null && isVideo(after);
  if (videoBefore && videoAfter && before !== after) {
    return { t: at, compare: { before: before!, after: after!, tBefore: last, tAfter: at } };
  }
  if (videoAfter && !videoBefore) return { t: at, compare: null };
  if (videoBefore && !videoAfter) return { t: last, compare: null };
  return { t: resizing === "after" ? at : last, compare: null };
}

/** The switches in time order (the order segment indexes refer to). */
export const inTimeOrder = (switches: CameraSwitch[]) =>
  [...switches].sort((a, b) => a.at_s - b.at_s);

/** What is selected on the timeline: a channel segment (by its switch) or a cut. */
export interface Picked {
  kind: "segment" | "cut";
  index: number;
}

/** One stretch during which a single channel (a camera or a still) is on screen. */
export interface Segment {
  /** Which switch (in time order) starts it; -1 for the opening stretch before the first switch. */
  index: number;
  /** The channel shown, with the default camera already resolved. */
  channel: string | null;
  start: number;
  end: number;
}

/** The edit's switches as consecutive segments from 0 to `end`. */
export function segments(
  switches: CameraSwitch[],
  fallback: string | null,
  end: number,
): Segment[] {
  const ordered = inTimeOrder(switches);
  const out: Segment[] = [];
  const first = ordered[0]?.at_s ?? end;
  if (first > 0) out.push({ index: -1, channel: fallback, start: 0, end: first });
  ordered.forEach((s, i) =>
    out.push({
      index: i,
      channel: s.media_id ?? fallback,
      start: s.at_s,
      end: ordered[i + 1]?.at_s ?? end,
    }),
  );
  return out;
}

/**
 * The switches (in time order) with switch `index` moved to `at_s`. It can't pass its neighbours,
 * so moving the edge between two segments just lengthens one and shortens the other.
 */
export function movedSwitches(
  switches: CameraSwitch[],
  index: number,
  at_s: number,
  end: number,
): CameraSwitch[] {
  const ordered = inTimeOrder(switches);
  if (index < 0 || index >= ordered.length) return ordered;
  const lower = index > 0 ? ordered[index - 1].at_s + MIN_SEGMENT_S : 0;
  const upper = index + 1 < ordered.length ? ordered[index + 1].at_s - MIN_SEGMENT_S : end;
  if (lower > upper) return ordered;
  return ordered.map((s, i) =>
    i === index ? { ...s, at_s: Math.min(upper, Math.max(lower, at_s)) } : s,
  );
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

/** The timeline never gets shorter than this (its ruler and about four rows), however little room there is. */
export const TIMELINE_MIN_PX = 168;
/** The view's height limits, and the widest it may be (two thirds of the stage's width). */
export const PLAYER_MIN_PX = 140;
export const PLAYER_MAX_PX = 900;
export const PLAYER_MAX_WIDTH_SHARE = 2 / 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * How the stage's height is divided between the active view and the timeline.
 *
 * The view is greedy: it takes as much as it can use (up to two thirds of the width, in 16:9),
 * and the timeline gets what is left, scrolling inside itself when its rows don't fit but never
 * shorter than about four rows. So adding rows never shrinks a view that is at full size, and
 * removing them lets the view grow back. Computed in pixels (not CSS percentages or container
 * units) so every browser agrees and both heights come from one place.
 */
export function stageLayout(a: {
  stageW: number;
  stageH: number;
  /** Padding and gap the stage spends itself, and the room under the view for the time and buttons. */
  padX: number;
  padY: number;
  gap: number;
  below: number;
  /** The timeline's height if nothing made it scroll. */
  naturalTimeline: number;
}): { boxH: number; playerH: number } {
  const usableH = a.stageH - a.padY - a.gap;
  const fullView = clamp(
    (a.stageW - a.padX) * PLAYER_MAX_WIDTH_SHARE * (9 / 16),
    PLAYER_MIN_PX,
    PLAYER_MAX_PX,
  );
  const room = usableH - (fullView + a.below);
  const boxH = Math.max(TIMELINE_MIN_PX, Math.min(a.naturalTimeline, room));
  const playerH = clamp(Math.min(usableH - boxH - a.below, fullView), PLAYER_MIN_PX, PLAYER_MAX_PX);
  return { boxH, playerH };
}

/** Channels (cameras and stills) that some segment of the edit shows, the default camera included. */
export function usedChannelIds(
  switches: CameraSwitch[],
  fallback: string | null,
  end: number,
): Set<string> {
  const used = new Set<string>();
  for (const seg of segments(switches, fallback, end)) {
    if (seg.channel !== null && seg.end > seg.start) used.add(seg.channel);
  }
  return used;
}

/** Media of one folder (a directory of the project folder, or somewhere else in the library). */
export interface MediaGroup {
  key: string;
  /** The folder as a breadcrumb, e.g. "day 1 / camera A"; empty for the project folder itself. */
  title: string;
  external: boolean;
  items: MediaItem[];
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The media view's folder hierarchy: the project folder first, then its subfolders by name, then
 * media referenced from elsewhere in the library. Within a folder: cameras, audio, then stills.
 */
export function groupMedia(media: MediaItem[]): MediaGroup[] {
  const groups = new Map<string, MediaGroup>();
  for (const m of media) {
    const key = `${m.external ? "~" : ""}${m.folder}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: m.folder.split("/").filter(Boolean).join(" / "),
        external: m.external,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(m);
  }
  const rank = (g: MediaGroup) => (g.external ? 2 : g.key === "" ? 0 : 1);
  return [...groups.values()]
    .map((g) => ({ ...g, items: sortMedia(g.items) }))
    .sort((a, b) => rank(a) - rank(b) || naturalOrder.compare(a.key, b.key));
}

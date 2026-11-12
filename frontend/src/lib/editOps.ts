// Immutable edit operations. Every function returns a new EditList.
import type { Cut, EditList, MediaItem, MixRegion } from "./api";
import {
  activeChannel,
  EPS,
  effectiveTracks,
  inTimeOrder,
  cutRanges,
  mergeRanges,
  movedSwitches,
  type Range,
} from "./timeline";

const SAME_TIME = 0.05;

/**
 * Show a channel over a range, then go back to whatever was showing at its end (a cutaway).
 * Switches inside the range are hidden by it, so they are dropped.
 */
export function showOver(
  edit: EditList,
  fallback: string | null,
  media_id: string,
  start_s: number,
  end_s: number,
): EditList {
  const returnTo = activeChannel(edit.switches, end_s, fallback);
  const outside = edit.switches.filter((s) => s.at_s <= start_s || s.at_s >= end_s);
  return setCamera(setCamera({ ...edit, switches: outside }, start_s, media_id), end_s, returnTo);
}

/** From `at_s` on, show this channel (a camera or a still). */
export function setCamera(edit: EditList, at_s: number, media_id: string | null): EditList {
  const others = edit.switches.filter((s) => Math.abs(s.at_s - at_s) > SAME_TIME);
  const switches = [...others, { at_s, media_id }].sort((a, b) => a.at_s - b.at_s);
  // A switch to the channel that is already showing changes nothing.
  const compact = switches.filter((s, i) => i === 0 || s.media_id !== switches[i - 1].media_id);
  return { ...edit, switches: compact };
}

/** Delete the segment that starts at switch `index` (in time order): the one before it carries on. */
export function deleteSegment(edit: EditList, index: number): EditList {
  const ordered = inTimeOrder(edit.switches);
  if (index < 0 || index >= ordered.length) return edit;
  const rest = ordered.filter((_, i) => i !== index);
  // The segment before may now meet one showing the same channel: that is one segment.
  const switches = rest.filter((s, i) => i === 0 || s.media_id !== rest[i - 1].media_id);
  return { ...edit, switches };
}

/** Move the start of the segment that starts at switch `index` (and so the end of the one before). */
export function moveSegmentEdge(
  edit: EditList,
  index: number,
  at_s: number,
  end: number,
): EditList {
  return { ...edit, switches: movedSwitches(edit.switches, index, at_s, end) };
}

export function removeSwitch(edit: EditList, index: number): EditList {
  return { ...edit, switches: edit.switches.filter((_, i) => i !== index) };
}

export function addCuts(edit: EditList, cuts: Cut[]): EditList {
  const merged = mergeRanges([
    ...edit.cuts.map((c): [number, number] => [c.start_s, c.end_s]),
    ...cuts.map((c): [number, number] => [c.start_s, c.end_s]),
  ]);
  return { ...edit, cuts: merged.map(([start_s, end_s]) => ({ start_s, end_s })) };
}

/** Move a cut's edges. Overlapping or touching cuts merge, so the list stays sorted and disjoint. */
export function setCut(edit: EditList, index: number, start_s: number, end_s: number): EditList {
  const cuts = edit.cuts.map((c, i) => (i === index ? { ...c, start_s, end_s } : c));
  return addCuts({ ...edit, cuts: [] }, cuts);
}

export function removeCut(edit: EditList, index: number): EditList {
  return { ...edit, cuts: edit.cuts.filter((_, i) => i !== index) };
}

/** Change a track's overall gain. The first change writes out the default track list. */
export function setTrack(
  edit: EditList,
  media: MediaItem[],
  media_id: string,
  patch: { gain_db?: number; muted?: boolean },
): EditList {
  const tracks = effectiveTracks(edit, media).map((t) =>
    t.media_id === media_id ? { ...t, ...patch } : t,
  );
  return { ...edit, tracks };
}

/**
 * Use (or stop using) a file's audio in the output. The first change writes out the default
 * track list; a camera's audio is excluded until you include it.
 */
export function setAudioIncluded(
  edit: EditList,
  media: MediaItem[],
  media_id: string,
  included: boolean,
): EditList {
  const tracks = effectiveTracks(edit, media);
  if (tracks.some((t) => t.media_id === media_id)) {
    return {
      ...edit,
      tracks: tracks.map((t) => (t.media_id === media_id ? { ...t, muted: !included } : t)),
    };
  }
  return included ? { ...edit, tracks: [...tracks, { media_id, gain_db: 0, muted: false }] } : edit;
}

/**
 * Put a level change on a track over a stretch. It paints over anything already there on that
 * track: overlapped regions are trimmed or split so regions on one track never overlap.
 */
export function addMix(edit: EditList, region: MixRegion): EditList {
  const kept: MixRegion[] = [];
  for (const r of edit.mix) {
    if (r.media_id !== region.media_id || r.end_s <= region.start_s || r.start_s >= region.end_s) {
      kept.push(r);
      continue;
    }
    if (r.start_s < region.start_s - EPS) kept.push({ ...r, end_s: region.start_s });
    if (r.end_s > region.end_s + EPS) kept.push({ ...r, start_s: region.end_s });
  }
  const mix = [...kept, region].sort((a, b) => a.start_s - b.start_s);
  return { ...edit, mix };
}

/** Show or hide a camera or still in the playback grid (and give or take its channel number). */
export function setEnabled(edit: EditList, media_id: string, enabled: boolean): EditList {
  const rest = edit.disabled.filter((d) => d !== media_id);
  return { ...edit, disabled: enabled ? rest : [...rest, media_id] };
}

/**
 * Turn a whole set of the project's media on or off at once (a folder's worth): cameras and stills
 * are shown or hidden, audio files are used in the output or left out.
 */
export function setAllEnabled(
  edit: EditList,
  media: MediaItem[],
  items: MediaItem[],
  enabled: boolean,
): EditList {
  let next = edit;
  for (const m of items) {
    next =
      m.kind === "audio"
        ? setAudioIncluded(next, media, m.id, enabled)
        : setEnabled(next, m.id, enabled);
  }
  return next;
}

/**
 * Point every reference to a media item at another id (it was relinked to a different file). Returns
 * the same edit when nothing refers to it, so unsaved-changes checks by identity keep working.
 */
export function renameMedia(edit: EditList, from: string, to: string): EditList {
  const uses =
    edit.switches.some((s) => s.media_id === from) ||
    edit.tracks.some((t) => t.media_id === from) ||
    edit.mix.some((m) => m.media_id === from) ||
    edit.disabled.includes(from);
  if (!uses) return edit;
  const swap = (id: string | null) => (id === from ? to : id);
  return {
    ...edit,
    switches: edit.switches.map((s) => ({ ...s, media_id: swap(s.media_id) })),
    tracks: edit.tracks.map((t) => ({ ...t, media_id: t.media_id === from ? to : t.media_id })),
    mix: edit.mix.map((m) => ({ ...m, media_id: m.media_id === from ? to : m.media_id })),
    disabled: edit.disabled.map((d) => (d === from ? to : d)),
  };
}

export function removeMix(edit: EditList, index: number): EditList {
  return { ...edit, mix: edit.mix.filter((_, i) => i !== index) };
}

/** The closest the two edges of a selection may get. */
export const MIN_SELECTION_S = 0.1;

/** Move the selection's start (`edge` 0) or end (1) to `at_s`, kept on the timeline and clear of the other edge. */
export function moveSelectionEdge(sel: Range, edge: 0 | 1, at_s: number, end: number): Range {
  const value = Math.round(at_s * 1000) / 1000;
  return edge === 0
    ? [Math.max(0, Math.min(value, sel[1] - MIN_SELECTION_S)), sel[1]]
    : [sel[0], Math.min(end, Math.max(value, sel[0] + MIN_SELECTION_S))];
}

/** Take [start, end] out of every cut it overlaps; a cut it falls inside of is split in two. */
export function uncut(edit: EditList, start: number, end: number): EditList {
  const cuts = edit.cuts.flatMap((c) => {
    if (c.end_s <= start + EPS || c.start_s >= end - EPS) return [c];
    return [
      ...(c.start_s < start - EPS ? [{ ...c, end_s: start }] : []),
      ...(c.end_s > end + EPS ? [{ ...c, start_s: end }] : []),
    ];
  });
  return { ...edit, cuts };
}

/** The mix region on a track that covers the whole selection (the last one wins), if any. */
export function levelOver(edit: EditList, media_id: string, sel: Range): MixRegion | null {
  const covering = edit.mix.filter(
    (r) => r.media_id === media_id && r.start_s <= sel[0] + EPS && r.end_s >= sel[1] - EPS,
  );
  return covering[covering.length - 1] ?? null;
}

/** Is the whole selection already inside cuts (so cutting it would change nothing)? */
export function insideCuts(edit: EditList, sel: Range): boolean {
  return mergeRanges(cutRanges(edit.cuts)).some(([a, b]) => a <= sel[0] + EPS && b >= sel[1] - EPS);
}

/** Does the selection overlap any cut (so there is something to take back)? */
export function overlapsCut(edit: EditList, sel: Range): boolean {
  return edit.cuts.some((c) => c.end_s > sel[0] + EPS && c.start_s < sel[1] - EPS);
}

// Immutable edit operations. Every function returns a new EditList.
import type { Cut, EditList, MediaItem, MixRegion } from "./api";
import { activeChannel, EPS, effectiveTracks, mergeRanges } from "./timeline";

const SAME_TIME = 0.05;

/** From `at_s` on, show this channel (a camera or a still). */
export function setCamera(edit: EditList, at_s: number, media_id: string | null): EditList {
  const others = edit.switches.filter((s) => Math.abs(s.at_s - at_s) > SAME_TIME);
  const switches = [...others, { at_s, media_id }].sort((a, b) => a.at_s - b.at_s);
  // A switch to the channel that is already showing changes nothing.
  const compact = switches.filter((s, i) => i === 0 || s.media_id !== switches[i - 1].media_id);
  return { ...edit, switches: compact };
}

/**
 * Show a still over a range, then go back to whatever was showing at its end. Switches that fall
 * inside the range are hidden by the still, so they are dropped (the one in force at the end is
 * what we return to).
 */
export function showStill(
  edit: EditList,
  fallback: string | null,
  stillId: string,
  start_s: number,
  end_s: number,
): EditList {
  const returnTo = activeChannel(edit.switches, end_s, fallback);
  const outside = edit.switches.filter((s) => s.at_s <= start_s || s.at_s >= end_s);
  return setCamera(setCamera({ ...edit, switches: outside }, start_s, stillId), end_s, returnTo);
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

export function removeMix(edit: EditList, index: number): EditList {
  return { ...edit, mix: edit.mix.filter((_, i) => i !== index) };
}

export function setRange(
  edit: EditList,
  range_in_s: number | null,
  range_out_s: number | null,
): EditList {
  return { ...edit, range_in_s, range_out_s };
}

// Immutable edit operations. Every function returns a new EditList.
import type { Cut, EditList, MediaItem, Still } from "./api";
import { effectiveTracks, mergeRanges } from "./timeline";

const SAME_TIME = 0.05;

export function setCamera(edit: EditList, at_s: number, media_id: string): EditList {
  const others = edit.switches.filter((s) => Math.abs(s.at_s - at_s) > SAME_TIME);
  const switches = [...others, { at_s, media_id }].sort((a, b) => a.at_s - b.at_s);
  // A switch to the camera that is already active changes nothing.
  const compact = switches.filter((s, i) => i === 0 || s.media_id !== switches[i - 1].media_id);
  return { ...edit, switches: compact };
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

export function removeCut(edit: EditList, index: number): EditList {
  return { ...edit, cuts: edit.cuts.filter((_, i) => i !== index) };
}

export function addStill(
  edit: EditList,
  media_id: string,
  start_s: number,
  end_s: number,
  id = `still-${Date.now().toString(36)}`,
): EditList {
  const still: Still = { id, media_id, start_s, end_s };
  return { ...edit, stills: [...edit.stills, still].sort((a, b) => a.start_s - b.start_s) };
}

export function removeStill(edit: EditList, id: string): EditList {
  return { ...edit, stills: edit.stills.filter((s) => s.id !== id) };
}

/** Change a track's gain or mute. The first change writes out the default track list. */
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

export function setRange(
  edit: EditList,
  range_in_s: number | null,
  range_out_s: number | null,
): EditList {
  return { ...edit, range_in_s, range_out_s };
}

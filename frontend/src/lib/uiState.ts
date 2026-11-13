// What the page remembers across a reload: the tab, the playhead, the selection and the picked
// segment. A convenience of this browser (localStorage), kept per project; it is never part of the
// project, so it can be missing or stale and nothing depends on it.
import type { Picked, Range } from "./timeline";

export interface UiState {
  tab?: string;
  t?: number;
  selection?: Range | null;
  picked?: Picked | null;
}

const key = (slug: string) => `edith.ui.${slug}`;

export function loadUi(slug: string): UiState {
  try {
    const raw = localStorage.getItem(key(slug));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as UiState) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into what is remembered for the project. */
export function saveUi(slug: string, patch: UiState): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify({ ...loadUi(slug), ...patch }));
  } catch {
    // Private windows and blocked storage: the page just forgets.
  }
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A remembered playhead, if it is still inside the timeline. */
export function restoredTime(saved: UiState, end: number): number | null {
  return isNumber(saved.t) && saved.t >= 0 && saved.t <= end ? saved.t : null;
}

/** A remembered selection, if it is still a range inside the timeline. */
export function restoredSelection(saved: UiState, end: number): Range | null {
  const s = saved.selection;
  if (!Array.isArray(s) || s.length !== 2 || !isNumber(s[0]) || !isNumber(s[1])) return null;
  return s[0] >= 0 && s[0] < s[1] && s[1] <= end ? [s[0], s[1]] : null;
}

/** A remembered pick, if what it points at is still there (the edit may have changed). */
export function restoredPick(
  saved: UiState,
  counts: { switches: number; cuts: number; mix: number },
): Picked | null {
  const p = saved.picked;
  if (!p || !isNumber(p.index) || !Number.isInteger(p.index)) return null;
  if (p.kind === "segment") return p.index >= -1 && p.index < counts.switches ? p : null;
  if (p.kind === "cut") return p.index >= 0 && p.index < counts.cuts ? p : null;
  if (p.kind === "mix") return p.index >= 0 && p.index < counts.mix ? p : null;
  return null; // a selection handle is not kept
}

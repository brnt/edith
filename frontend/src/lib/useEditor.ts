import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { fetchSilence, type EditList, type MediaItem, type SyncState } from "./api";
import {
  addCuts,
  deleteSegment,
  insideCuts,
  moveSegmentEdge,
  removeMix,
  setMixLevel,
  setMixRegion,
  uncut,
  moveSelectionEdge,
  removeCut,
  setCamera,
  setCut,
  showOver,
} from "./editOps";
import {
  advancePlayhead,
  channelsOf,
  cutRanges,
  defaultCamera,
  EPS,
  firstKeptMoment,
  fitPxPerSec,
  keepIntervals,
  mediaOffsets,
  nudgeStep,
  playbackEnd,
  skipCuts,
  timelineEnd,
  type Picked,
  type Preview,
  type Range,
} from "./timeline";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

interface Args {
  slug: string;
  media: MediaItem[];
  sync: SyncState | null;
  edit: EditList;
  onEdit: (edit: EditList) => void;
  onError: (message: string) => void;
  /** Media and sync have loaded, so cut times and the timeline length are final. */
  ready: boolean;
}

/** Playhead, playback, selection, zoom, and dead-time state shared by the stage and the ribbon. */
export function useEditor({ slug, media, sync, edit, onEdit, onError, ready }: Args) {
  const offsets = useMemo(() => mediaOffsets(media, sync), [media, sync]);
  const end = timelineEnd(media, offsets);
  const keeps = useMemo(() => keepIntervals(0, end, cutRanges(edit.cuts)), [end, edit.cuts]);
  const outputLength = keeps.reduce((sum, [a, b]) => sum + (b - a), 0);
  const firstKept = firstKeptMoment(keeps, 0);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Range | null>(null);
  // A segment or cut selected by clicking it (the thing Delete removes and whose edges can be dragged).
  const [picked, setPicked] = useState<Picked | null>(null);
  // The edit as it would be if the edge being dragged were dropped now: what the preview shows.
  const [preview, setPreview] = useState<Preview | null>(null);
  // null = fit the window width (and keep fitting on resize) until the user zooms.
  const [zoom, setZoom] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const timelineBox = useRef<HTMLDivElement>(null);
  // The player owns one <video>/<audio> per proxy; the camera tiles paint frames from the same
  // elements, so showing another camera costs no extra decoding.
  const mediaElements = useRef<Record<string, HTMLMediaElement | null>>({});
  const [suggestions, setSuggestions] = useState<Range[]>([]);
  const [silence, setSilence] = useState({ threshold: -50, minS: 2, pad: 0.4 });

  const channels = useMemo(() => channelsOf(media, edit.disabled), [media, edit.disabled]);
  const fallback = defaultCamera(media, offsets);
  const fitPx = fitPxPerSec(width, end);
  const pxPerSec = zoom ?? fitPx;

  const state = useRef({ t, playing, keeps, selection, picked, edit, fallback });
  state.current = { t, playing, keeps, selection, picked, edit, fallback };

  useEffect(() => {
    const el = timelineBox.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Open on the first moment that is not cut, once, when everything has loaded.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !ready) return;
    placed.current = true;
    setT(firstKept);
  }, [ready, firstKept]);

  // Playback: advance a wall clock, jumping cuts and stopping at the last kept moment.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const moved = advancePlayhead(state.current.t, dt, state.current.keeps);
      setT(moved.t);
      if (moved.ended) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const togglePlay = () => {
    const { playing: on, t: current, keeps: ks } = state.current;
    if (on) return setPlaying(false);
    setT(current >= playbackEnd(ks) - 0.05 ? skipCuts(0, ks) : skipCuts(current, ks));
    setPlaying(true);
  };

  /** Show a channel from the playhead on, or, with a range selected, over just that range. */
  const cutTo = (mediaId: string | null) => {
    const { edit: current, t: at, selection: sel, fallback: fb } = state.current;
    if (sel && mediaId !== null) {
      onEdit(showOver(current, fb, mediaId, sel[0], sel[1]));
      select(null);
    } else onEdit(setCamera(current, at, mediaId));
  };

  const cutSelection = () => {
    const sel = state.current.selection;
    if (!sel || insideCuts(state.current.edit, sel)) return;
    onEdit(addCuts(state.current.edit, [{ start_s: sel[0], end_s: sel[1] }]));
    select(null);
  };

  /** Take the selection back out of any cuts it overlaps. */
  const uncutSelection = () => {
    const sel = state.current.selection;
    if (!sel) return;
    onEdit(uncut(state.current.edit, sel[0], sel[1]));
  };

  const deletePicked = () => {
    const { picked: p, edit: current, fallback: fb } = state.current;
    if (!p) return;
    if (p.kind === "edge") return; // a selection handle is moved, not deleted
    if (p.kind === "mix") onEdit(removeMix(current, p.index));
    else
      onEdit(
        p.kind === "segment" ? deleteSegment(current, p.index, fb) : removeCut(current, p.index),
      );
    setPicked(null);
  };

  /** Select a range; it replaces a picked segment or cut (the two don't coexist). */
  const select = (range: Range | null) => {
    setSelection(range);
    // A selected handle belongs to the selection, so it goes with it.
    setPicked((p) => (range === null && p?.kind === "edge" ? null : range ? null : p));
  };

  /** Pick something to work on; a selection and a picked segment or cut don't coexist (its handles do). */
  const pick = (next: Picked | null) => {
    setPicked(next);
    if (next && next.kind !== "edge") setSelection(null);
    // Selecting a handle puts the playhead on that edge, so the frame there can be checked.
    const sel = state.current.selection;
    if (next?.kind === "edge" && sel) scrub(sel[next.index]);
  };

  /** Put the playhead on `at` (stopping playback), e.g. while an edge is being dragged. */
  const scrub = (at: number) => {
    setPlaying(false);
    setT(at);
  };

  const changeSegmentEdge = (switchIndex: number, at_s: number) =>
    onEdit(moveSegmentEdge(state.current.edit, switchIndex, at_s, end));

  /** A picked audio level's edges were dragged: move it, and stay on it (painting over a neighbour can renumber). */
  const changeMix = (index: number, start_s: number, end_s: number) => {
    const region = state.current.edit.mix[index];
    if (!region) return;
    const next = setMixRegion(state.current.edit, index, start_s, end_s);
    onEdit(next);
    const now = next.mix.findIndex(
      (r) =>
        r.media_id === region.media_id &&
        Math.abs(r.start_s - start_s) < EPS &&
        Math.abs(r.end_s - end_s) < EPS,
    );
    setPicked(now >= 0 ? { kind: "mix", index: now } : null);
  };

  /** Set the level, or mute, of the picked audio level. */
  const setPickedMix = (gain_db: number, muted: boolean) => {
    const p = state.current.picked;
    if (p?.kind === "mix") onEdit(setMixLevel(state.current.edit, p.index, gain_db, muted));
  };

  const changeCut = (index: number, start_s: number, end_s: number) => {
    const next = setCut(state.current.edit, index, start_s, end_s);
    onEdit(next);
    // Merging with a neighbour can renumber the cuts: stay on the one that was dragged.
    const now = next.cuts.findIndex((c) => c.start_s <= start_s + EPS && c.end_s >= end_s - EPS);
    setPicked(now >= 0 ? { kind: "cut", index: now } : null);
  };

  /** A selection handle was dragged (or nudged): move that edge and put the playhead on it. */
  const changeSelectionEdge = (edge: 0 | 1, at_s: number) => {
    const sel = state.current.selection;
    if (!sel) return;
    const next = moveSelectionEdge(sel, edge, at_s, end);
    setSelection(next);
    scrub(next[edge]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight";
      // Modifiers pick the arrow's step size (nudgeStep); for any other key they mean something else.
      if (isTyping(e.target) || (!arrow && (e.metaKey || e.ctrlKey || e.altKey))) return;
      const cur = state.current;
      const step =
        nudgeStep(e, cur.edit.fps_den / cur.edit.fps_num) * (e.key === "ArrowLeft" ? -1 : 1);
      if (e.key === "Escape") {
        if (!cur.picked && !cur.selection) return;
        if (cur.picked) setPicked(null);
        else setSelection(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && cur.picked) deletePicked();
      else if (e.key === " ") togglePlay();
      else if (arrow && cur.picked?.kind === "edge" && cur.selection) {
        // A selected handle is nudged by the arrow keys, by the same steps as the playhead.
        const edge = cur.picked.index === 0 ? 0 : 1;
        changeSelectionEdge(edge, cur.selection[edge] + step);
      } else if (arrow) setT(Math.min(end, Math.max(0, cur.t + step)));
      else if (e.key === "x") cutSelection();
      else if (/^[1-9]$/.test(e.key) && channels.find((c) => c.number === Number(e.key)))
        cutTo(channels.find((c) => c.number === Number(e.key))!.item.id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [channels, end]);

  const findDeadTime = async () => {
    try {
      const { cuts } = await fetchSilence(
        slug,
        silence.threshold,
        silence.minS,
        silence.pad,
        state.current.selection,
      );
      setSuggestions(cuts.map((c): Range => [c.start_s, c.end_s]));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    media,
    edit,
    onEdit,
    offsets,
    end,
    firstKept,
    keeps,
    outputLength,
    t,
    setT,
    playing,
    togglePlay,
    selection,
    setSelection: select,
    picked,
    pick,
    changeSegmentEdge,
    scrub,
    preview,
    setPreview,
    changeCut,
    changeMix,
    setPickedMix,
    changeSelectionEdge,
    zoom,
    setZoom,
    pxPerSec,
    timelineBox,
    mediaElements,
    suggestions,
    setSuggestions,
    silence,
    setSilence,
    findDeadTime,
    channels,
    fallback,
    cutTo,
    cutSelection,
    uncutSelection,
  };
}

export type EditorApi = ReturnType<typeof useEditor>;

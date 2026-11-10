import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { fetchSilence, type EditList, type MediaItem, type SyncState } from "./api";
import {
  addCuts,
  deleteSegment,
  moveSegmentEdge,
  removeCut,
  setCamera,
  setCut,
  setRange,
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
  const lo = edit.range_in_s ?? 0;
  const hi = edit.range_out_s ?? end;
  const keeps = useMemo(() => keepIntervals(lo, hi, cutRanges(edit.cuts)), [lo, hi, edit.cuts]);
  const outputLength = keeps.reduce((sum, [a, b]) => sum + (b - a), 0);
  const firstKept = firstKeptMoment(keeps, lo);

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

  const state = useRef({ t, playing, keeps, selection, picked, edit, lo, fallback });
  state.current = { t, playing, keeps, selection, picked, edit, lo, fallback };

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
    const { playing: on, t: current, keeps: ks, lo: start } = state.current;
    if (on) return setPlaying(false);
    setT(current >= playbackEnd(ks) - 0.05 ? skipCuts(start, ks) : skipCuts(current, ks));
    setPlaying(true);
  };

  /** Show a channel from the playhead on, or, with a range selected, over just that range. */
  const cutTo = (mediaId: string | null) => {
    const { edit: current, t: at, selection: sel, fallback: fb } = state.current;
    if (sel && mediaId !== null) {
      onEdit(showOver(current, fb, mediaId, sel[0], sel[1]));
      setSelection(null);
    } else onEdit(setCamera(current, at, mediaId));
  };

  const cutSelection = () => {
    const sel = state.current.selection;
    if (!sel) return;
    onEdit(addCuts(state.current.edit, [{ start_s: sel[0], end_s: sel[1] }]));
    setSelection(null);
  };

  const deletePicked = () => {
    const { picked: p, edit: current } = state.current;
    if (!p) return;
    onEdit(p.kind === "segment" ? deleteSegment(current, p.index) : removeCut(current, p.index));
    setPicked(null);
  };

  /** Pick something to work on; a range selection and a picked item don't coexist. */
  const pick = (next: Picked | null) => {
    setPicked(next);
    if (next) setSelection(null);
  };

  /** Put the playhead on `at` (stopping playback), e.g. while an edge is being dragged. */
  const scrub = (at: number) => {
    setPlaying(false);
    setT(at);
  };

  const changeSegmentEdge = (switchIndex: number, at_s: number) =>
    onEdit(moveSegmentEdge(state.current.edit, switchIndex, at_s, end));

  const changeCut = (index: number, start_s: number, end_s: number) => {
    const next = setCut(state.current.edit, index, start_s, end_s);
    onEdit(next);
    // Merging with a neighbour can renumber the cuts: stay on the one that was dragged.
    const now = next.cuts.findIndex((c) => c.start_s <= start_s + EPS && c.end_s >= end_s - EPS);
    setPicked(now >= 0 ? { kind: "cut", index: now } : null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = state.current;
      if (e.key === "Escape") {
        if (!cur.picked && !cur.selection) return;
        if (cur.picked) setPicked(null);
        else setSelection(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && cur.picked) deletePicked();
      else if (e.key === " ") togglePlay();
      else if (e.key === "ArrowLeft") setT(Math.max(0, cur.t - (e.shiftKey ? 10 : 1)));
      else if (e.key === "ArrowRight") setT(Math.min(end, cur.t + (e.shiftKey ? 10 : 1)));
      else if (e.key === "x") cutSelection();
      else if (e.key === "i") onEdit(setRange(cur.edit, cur.t, cur.edit.range_out_s));
      else if (e.key === "o") onEdit(setRange(cur.edit, cur.edit.range_in_s, cur.t));
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
      const { cuts } = await fetchSilence(slug, silence.threshold, silence.minS, silence.pad);
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
    lo,
    firstKept,
    keeps,
    outputLength,
    t,
    setT,
    playing,
    togglePlay,
    selection,
    setSelection,
    picked,
    pick,
    changeSegmentEdge,
    scrub,
    preview,
    setPreview,
    changeCut,
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
  };
}

export type EditorApi = ReturnType<typeof useEditor>;

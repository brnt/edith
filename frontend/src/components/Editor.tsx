import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  fetchSilence,
  type EditList,
  type MediaItem,
  type Peaks,
  type SyncState,
} from "../lib/api";
import {
  addCuts,
  addStill,
  removeCut,
  removeStill,
  removeSwitch,
  setCamera,
  setRange,
  setTrack,
} from "../lib/editOps";
import {
  cutRanges,
  fitPxPerSec,
  formatTime,
  keepIntervals,
  mediaOffsets,
  skipCuts,
  timelineEnd,
  timelineToOutput,
  type Range,
} from "../lib/timeline";
import { Player } from "./Player";
import { Timeline } from "./Timeline";
import { Button } from "./ui";

interface Props {
  slug: string;
  media: MediaItem[];
  sync: SyncState | null;
  edit: EditList;
  peaks: Record<string, Peaks>;
  onEdit: (edit: EditList) => void;
  onError: (message: string) => void;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

export function Editor({ slug, media, sync, edit, peaks, onEdit, onError }: Props) {
  const offsets = useMemo(() => mediaOffsets(media, sync), [media, sync]);
  const end = timelineEnd(media, offsets);
  const lo = edit.range_in_s ?? 0;
  const hi = edit.range_out_s ?? end;
  const keeps = useMemo(() => keepIntervals(lo, hi, cutRanges(edit.cuts)), [lo, hi, edit.cuts]);
  const outputLength = keeps.reduce((sum, [a, b]) => sum + (b - a), 0);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Range | null>(null);
  // null = fit the window width (and keep fitting on resize) until the user zooms.
  const [zoom, setZoom] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const timelineBox = useRef<HTMLDivElement>(null);
  const fitPx = fitPxPerSec(width, end);
  const pxPerSec = zoom ?? fitPx;

  useEffect(() => {
    const el = timelineBox.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [suggestions, setSuggestions] = useState<Range[]>([]);
  const [silence, setSilence] = useState({ threshold: -50, minS: 2, pad: 0.4 });
  const [stillId, setStillId] = useState("");

  const cameras = media.filter((m) => m.kind === "video");
  const images = media.filter((m) => m.kind === "image");
  const state = useRef({ t, playing, keeps, hi, lo, selection, edit });
  state.current = { t, playing, keeps, hi, lo, selection, edit };

  useEffect(() => {
    if (!stillId && images.length) setStillId(images[0].id);
  }, [images.length]);

  // Playback: advance a wall clock, jumping over cuts and stopping at the end of the range.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const { t: current, keeps: ks, hi: out } = state.current;
      const next = current + dt;
      if (next >= out) {
        setT(out);
        setPlaying(false);
        return;
      }
      setT(skipCuts(next, ks));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const togglePlay = () => {
    const { playing: on, t: current, keeps: ks, hi: out, lo: start } = state.current;
    if (on) return setPlaying(false);
    setT(current >= out - 0.05 ? skipCuts(start, ks) : skipCuts(current, ks));
    setPlaying(true);
  };

  const cutTo = (mediaId: string) =>
    onEdit(setCamera(state.current.edit, state.current.t, mediaId));
  const cutSelection = () => {
    const sel = state.current.selection;
    if (!sel) return;
    onEdit(addCuts(state.current.edit, [{ start_s: sel[0], end_s: sel[1] }]));
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = state.current;
      if (e.key === " ") togglePlay();
      else if (e.key === "ArrowLeft") setT(Math.max(0, cur.t - (e.shiftKey ? 10 : 1)));
      else if (e.key === "ArrowRight") setT(Math.min(end, cur.t + (e.shiftKey ? 10 : 1)));
      else if (e.key === "x") cutSelection();
      else if (e.key === "i") onEdit(setRange(cur.edit, cur.t, cur.edit.range_out_s));
      else if (e.key === "o") onEdit(setRange(cur.edit, cur.edit.range_in_s, cur.t));
      else if (/^[1-9]$/.test(e.key) && cameras[Number(e.key) - 1])
        cutTo(cameras[Number(e.key) - 1].id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameras.length, end]);

  const findDeadTime = async () => {
    try {
      const { cuts } = await fetchSilence(slug, silence.threshold, silence.minS, silence.pad);
      setSuggestions(cuts.map((c): Range => [c.start_s, c.end_s]));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const num = (key: keyof typeof silence, step: number) => (
    <input
      type="number"
      step={step}
      class="w-16 rounded bg-neutral-800 px-1 py-0.5"
      value={silence[key]}
      aria-label={key}
      onChange={(e) => setSilence({ ...silence, [key]: Number(e.currentTarget.value) })}
    />
  );

  // Same numbering as the camera buttons, timeline rows, and number keys.
  const cameraNumber = (id: string) => cameras.findIndex((m) => m.id === id) + 1;
  const label = (id: string) => media.find((m) => m.id === id)?.label ?? id;
  const activeEdits = edit.switches.length + edit.cuts.length + edit.stills.length;

  return (
    <div class="space-y-3">
      <div class="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Player slug={slug} media={media} offsets={offsets} edit={edit} t={t} playing={playing} />
        <div class="space-y-3 text-sm">
          <div class="rounded border border-neutral-800 p-3">
            <div class="font-mono text-lg">
              {formatTime(t, 2)}
              <span class="ml-2 text-xs text-neutral-500">
                output {formatTime(timelineToOutput(t, keeps), 2)} / {formatTime(outputLength, 1)}
              </span>
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" onClick={togglePlay}>
                {playing ? "Pause (space)" : "Play (space)"}
              </Button>
              <Button onClick={() => setT(lo)}>⏮ Start</Button>
            </div>
          </div>
          <div class="rounded border border-neutral-800 p-3">
            <div class="mb-1 text-xs uppercase text-neutral-500">Camera from the playhead</div>
            <div class="flex flex-wrap gap-2">
              {cameras.map((m, i) => (
                <Button key={m.id} onClick={() => cutTo(m.id)}>
                  {i + 1} · {m.label}
                </Button>
              ))}
              {cameras.length === 0 && <span class="text-neutral-500">No video added.</span>}
            </div>
          </div>
          <div class="rounded border border-neutral-800 p-3">
            <div class="mb-1 text-xs uppercase text-neutral-500">
              Selection{" "}
              {selection
                ? `${formatTime(selection[0], 2)} – ${formatTime(selection[1], 2)}`
                : "(drag on the timeline)"}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button disabled={!selection} onClick={cutSelection}>
                Cut it out (x)
              </Button>
              <Button
                disabled={!selection}
                onClick={() => {
                  if (!selection) return;
                  onEdit(setRange(edit, selection[0], selection[1]));
                  setSelection(null);
                }}
              >
                Keep only this
              </Button>
              <select
                class="rounded bg-neutral-800 px-1 py-1"
                aria-label="Still image"
                value={stillId}
                onChange={(e) => setStillId(e.currentTarget.value)}
              >
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Button
                disabled={!selection || !stillId}
                onClick={() => {
                  if (!selection) return;
                  onEdit(addStill(edit, stillId, selection[0], selection[1]));
                  setSelection(null);
                }}
              >
                Show still
              </Button>
            </div>
            <div class="mt-2 flex gap-2">
              <Button onClick={() => onEdit(setRange(edit, t, edit.range_out_s))}>
                Start here (i)
              </Button>
              <Button onClick={() => onEdit(setRange(edit, edit.range_in_s, t))}>
                End here (o)
              </Button>
              <Button variant="ghost" onClick={() => onEdit(setRange(edit, null, null))}>
                Clear range
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 text-sm">
        <Button onClick={() => setZoom(Math.min(pxPerSec * 1.5, 400))}>Zoom in</Button>
        <Button onClick={() => setZoom(Math.max(pxPerSec / 1.5, 1))}>Zoom out</Button>
        <Button disabled={zoom === null} onClick={() => setZoom(null)}>
          Fit
        </Button>
        <span class="text-neutral-500">
          Click to place the playhead, drag to select. Output length {formatTime(outputLength, 1)}.
        </span>
      </div>

      <div ref={timelineBox}>
        <Timeline
          media={media}
          offsets={offsets}
          edit={edit}
          peaks={peaks}
          playhead={t}
          end={end}
          pxPerSec={pxPerSec}
          selection={selection}
          suggestions={suggestions}
          onSeek={setT}
          onSelect={setSelection}
          onCamera={cutTo}
          onTrack={(id, patch) => onEdit(setTrack(edit, media, id, patch))}
        />
      </div>

      <div class="rounded border border-neutral-800 p-3 text-sm">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span class="font-semibold">Dead time</span>
          <label>quieter than {num("threshold", 1)} dB</label>
          <label>for at least {num("minS", 0.5)} s</label>
          <label>keep {num("pad", 0.1)} s around speech</label>
          <Button onClick={findDeadTime}>Find dead time</Button>
          {suggestions.length > 0 && (
            <>
              <span class="text-amber-300">{suggestions.length} found</span>
              <Button
                variant="primary"
                onClick={() => {
                  onEdit(
                    addCuts(
                      edit,
                      suggestions.map(([a, b]) => ({ start_s: a, end_s: b })),
                    ),
                  );
                  setSuggestions([]);
                }}
              >
                Cut all
              </Button>
              <Button variant="ghost" onClick={() => setSuggestions([])}>
                Dismiss
              </Button>
            </>
          )}
        </div>
        <p class="text-xs text-neutral-500">
          Uses the saved range and tracks. Suggestions are outlined in amber on the timeline.
        </p>
      </div>

      <div class="grid gap-3 text-sm md:grid-cols-3">
        <DecisionList
          title="Camera switches"
          empty="Starts on the earliest camera."
          items={edit.switches.map((s, i) => ({
            key: `${s.at_s}-${s.media_id}`,
            text: `${formatTime(s.at_s, 1)} → Camera ${cameraNumber(s.media_id)}`,
            title: label(s.media_id),
            onSeek: () => setT(s.at_s),
            onRemove: () => onEdit(removeSwitch(edit, i)),
          }))}
        />
        <DecisionList
          title="Cuts"
          empty="Nothing cut."
          items={edit.cuts.map((c, i) => ({
            key: `${c.start_s}-${c.end_s}`,
            text: `${formatTime(c.start_s, 1)} – ${formatTime(c.end_s, 1)} (${(c.end_s - c.start_s).toFixed(1)} s)`,
            onSeek: () => setT(c.start_s),
            onRemove: () => onEdit(removeCut(edit, i)),
          }))}
        />
        <DecisionList
          title="Stills"
          empty="No stills."
          items={edit.stills.map((s) => ({
            key: s.id,
            text: `${formatTime(s.start_s, 1)} – ${formatTime(s.end_s, 1)} ${label(s.media_id)}`,
            onSeek: () => setT(s.start_s),
            onRemove: () => onEdit(removeStill(edit, s.id)),
          }))}
        />
      </div>
      {activeEdits === 0 && (
        <p class="text-xs text-neutral-500">
          Shortcuts: space play · 1–9 camera · x cut selection · i/o set range · ←/→ step.
        </p>
      )}
    </div>
  );
}

function DecisionList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { key: string; text: string; title?: string; onSeek: () => void; onRemove: () => void }[];
}) {
  return (
    <div class="rounded border border-neutral-800 p-3">
      <div class="mb-1 text-xs uppercase text-neutral-500">{title}</div>
      {items.length === 0 ? (
        <p class="text-neutral-500">{empty}</p>
      ) : (
        <ul class="space-y-1">
          {items.map((item) => (
            <li key={item.key} class="flex items-center justify-between gap-2">
              <button
                class="truncate text-left text-sky-300"
                title={item.title}
                onClick={item.onSeek}
              >
                {item.text}
              </button>
              <button
                class="text-neutral-500 hover:text-red-400"
                aria-label={`Remove ${item.text}`}
                onClick={item.onRemove}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

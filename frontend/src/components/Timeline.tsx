import { useRef } from "preact/hooks";

import type { EditList, MediaItem, Peaks } from "../lib/api";
import {
  cameraSpans,
  defaultCamera,
  effectiveTracks,
  formatTime,
  TIMELINE_LABEL_W as LABEL_W,
  type Range,
} from "../lib/timeline";
import { MAX_CANVAS_PX, Waveform } from "./Waveform";

const ROW = { ruler: 24, video: 34, still: 28, audio: 56 };

interface Props {
  media: MediaItem[];
  offsets: Record<string, number>;
  edit: EditList;
  peaks: Record<string, Peaks>;
  playhead: number;
  end: number;
  pxPerSec: number;
  selection: Range | null;
  suggestions: Range[];
  onSeek: (t: number) => void;
  onSelect: (range: Range | null) => void;
  onCamera: (mediaId: string) => void;
  onTrack: (mediaId: string, patch: { gain_db?: number; muted?: boolean }) => void;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

export function Timeline(props: Props) {
  const { media, offsets, edit, peaks, playhead, end, selection, suggestions } = props;
  const px = Math.min(props.pxPerSec, MAX_CANVAS_PX / Math.max(end, 1));
  const total = Math.max(end * px, 1);
  const lanes = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null);

  const cameras = media.filter((m) => m.kind === "video");
  const stills = media.filter((m) => m.kind === "image");
  const tracks = effectiveTracks(edit, media);
  const audioRows = media.filter((m) => tracks.some((t) => t.media_id === m.id));
  const fallback = defaultCamera(media, offsets);
  const lo = edit.range_in_s ?? 0;
  const hi = edit.range_out_s ?? end;
  const step = STEPS.find((s) => s * px >= 70) ?? STEPS[STEPS.length - 1];
  const bodyHeight =
    cameras.length * ROW.video + (stills.length ? ROW.still : 0) + audioRows.length * ROW.audio;

  const timeAt = (clientX: number) => {
    const rect = lanes.current?.getBoundingClientRect();
    return Math.min(end, Math.max(0, (clientX - (rect?.left ?? 0)) / px));
  };

  const down = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, t: timeAt(e.clientX), moved: false };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
    if (d.moved) {
      const t = timeAt(e.clientX);
      props.onSelect([Math.min(d.t, t), Math.max(d.t, t)]);
    }
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      props.onSeek(timeAt(e.clientX));
      props.onSelect(null);
    }
  };

  const x = (t: number) => t * px;
  const band = (range: Range, cls: string, key: string | number, top = 0, height = "100%") => (
    <div
      key={key}
      class={`pointer-events-none absolute ${cls}`}
      style={{ left: x(range[0]), width: Math.max(1, x(range[1] - range[0])), top, height }}
    />
  );

  const ticks: number[] = [];
  for (let t = 0; t <= end; t += step) ticks.push(t);

  return (
    <div
      class="overflow-x-auto rounded border border-neutral-800 bg-neutral-900"
      data-testid="timeline"
    >
      <div class="flex" style={{ width: LABEL_W + total }}>
        <div class="sticky left-0 z-20 bg-neutral-900" style={{ width: LABEL_W }}>
          <div style={{ height: ROW.ruler }} />
          {cameras.map((m, i) => (
            <div
              key={m.id}
              class="flex items-center gap-2 border-t border-neutral-800 px-2 text-xs"
              style={{ height: ROW.video }}
            >
              <button
                class="rounded bg-neutral-700 px-1.5 hover:bg-sky-600"
                title={`Switch to ${m.label} at the playhead (${i + 1})`}
                onClick={() => props.onCamera(m.id)}
              >
                {i + 1}
              </button>
              <span class="truncate">{m.label}</span>
            </div>
          ))}
          {stills.length > 0 && (
            <div
              class="flex items-center border-t border-neutral-800 px-2 text-xs text-neutral-400"
              style={{ height: ROW.still }}
            >
              Stills
            </div>
          )}
          {audioRows.map((m) => {
            const t = tracks.find((tr) => tr.media_id === m.id)!;
            return (
              <div
                key={m.id}
                class="border-t border-neutral-800 px-2 py-1 text-xs"
                style={{ height: ROW.audio }}
              >
                <div class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Mute ${m.label}`}
                    checked={t.muted}
                    onChange={(e) => props.onTrack(m.id, { muted: e.currentTarget.checked })}
                  />
                  <span class="truncate">{m.label}</span>
                </div>
                <input
                  type="range"
                  aria-label={`Gain ${m.label}`}
                  class="w-full"
                  min={-30}
                  max={12}
                  step={1}
                  value={t.gain_db}
                  onInput={(e) => props.onTrack(m.id, { gain_db: Number(e.currentTarget.value) })}
                />
                <span class="text-neutral-500">
                  {t.gain_db > 0 ? "+" : ""}
                  {t.gain_db} dB
                </span>
              </div>
            );
          })}
        </div>

        <div
          ref={lanes}
          class="relative cursor-crosshair select-none"
          style={{ width: total }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
        >
          <div class="relative" style={{ height: ROW.ruler }}>
            {ticks.map((t) => (
              <div
                key={t}
                class="absolute top-0 h-full border-l border-neutral-600 pl-1 text-[10px] text-neutral-400"
                style={{ left: x(t) }}
              >
                {formatTime(t, 0)}
              </div>
            ))}
          </div>

          {cameras.map((m) => {
            const off = offsets[m.id] ?? 0;
            return (
              <div
                key={m.id}
                class="relative border-t border-neutral-800"
                style={{ height: ROW.video }}
              >
                {band([off, off + (m.duration_s ?? 0)], "bg-neutral-700/60", "avail", 6, "22px")}
                {cameraSpans(edit.switches, m.id, fallback, lo, hi).map((span, i) =>
                  band(span, "bg-sky-500/80", i, 6, "22px"),
                )}
              </div>
            );
          })}

          {stills.length > 0 && (
            <div class="relative border-t border-neutral-800" style={{ height: ROW.still }}>
              {edit.stills.map((s) =>
                band([s.start_s, s.end_s], "bg-fuchsia-600/80", s.id, 4, "20px"),
              )}
            </div>
          )}

          {audioRows.map((m) => (
            <div
              key={m.id}
              class={`border-t border-neutral-800 ${tracks.find((t) => t.media_id === m.id)?.muted ? "opacity-30" : ""}`}
              style={{ height: ROW.audio }}
            >
              <Waveform
                peaks={peaks[m.id]}
                offset={offsets[m.id] ?? 0}
                pxPerSec={px}
                width={total}
                height={ROW.audio}
                color="#34d399"
              />
            </div>
          ))}

          {lo > 0 && band([0, lo], "bg-black/50", "in", ROW.ruler, `${bodyHeight}px`)}
          {hi < end && band([hi, end], "bg-black/50", "out", ROW.ruler, `${bodyHeight}px`)}
          {edit.cuts.map((c, i) =>
            band(
              [c.start_s, c.end_s],
              "bg-red-600/40 ring-1 ring-red-500",
              `cut${i}`,
              ROW.ruler,
              `${bodyHeight}px`,
            ),
          )}
          {suggestions.map((r, i) =>
            band(
              r,
              "border border-dashed border-amber-400 bg-amber-400/15",
              `s${i}`,
              ROW.ruler,
              `${bodyHeight}px`,
            ),
          )}
          {selection && band(selection, "bg-white/20 ring-1 ring-white/60", "sel", 0, "100%")}
          <div
            class="pointer-events-none absolute top-0 z-10 h-full w-px bg-red-500"
            style={{ left: x(playhead) }}
            data-testid="playhead"
          />
        </div>
      </div>
    </div>
  );
}

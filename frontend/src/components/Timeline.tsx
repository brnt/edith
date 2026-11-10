import { useRef, useState } from "preact/hooks";

import type { EditList, MediaItem, Peaks } from "../lib/api";
import {
  channelSpans,
  channelsOf,
  defaultCamera,
  effectiveTracks,
  formatTime,
  TIMELINE_LABEL_W as LABEL_W,
  type Channel,
  type Range,
} from "../lib/timeline";
import { AUDIO_WAVEFORM, channelStyle } from "../lib/channelStyle";
import { ChannelChip } from "./ChannelChip";
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
  onTrack: (mediaId: string, patch: { gain_db?: number }) => void;
  /** A cut's edges were dragged: its index and its new start and end. */
  onCutChange?: (index: number, start_s: number, end_s: number) => void;
}

const MIN_CUT_S = 0.1; // a dragged edge cannot squeeze a cut below this
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

export function Timeline(props: Props) {
  const { media, offsets, edit, peaks, playhead, end, selection, suggestions } = props;
  const px = Math.min(props.pxPerSec, MAX_CANVAS_PX / Math.max(end, 1));
  const total = Math.max(end * px, 1);
  const lanes = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  // An edge being dragged: shown live, committed once on release (one undo step).
  const [edgeDrag, setEdgeDrag] = useState<{
    index: number;
    edge: "start" | "end";
    value: number;
  } | null>(null);

  const channels = channelsOf(media);
  const cameras = channels.filter((c) => c.item.kind === "video");
  const stills = channels.filter((c) => c.item.kind === "image");
  // Stills sit in a disclosure group; open by default unless there are a lot of them.
  const [stillsChoice, setStillsChoice] = useState<boolean | null>(null);
  const stillsOpen = stillsChoice ?? stills.length <= 4;
  const tracks = effectiveTracks(edit, media);
  // Only audio that is in the output gets a row; include or exclude files in the Media tab.
  const audioRows = media.filter((m) => tracks.some((t) => t.media_id === m.id && !t.muted));
  const fallback = defaultCamera(media, offsets);
  const lo = edit.range_in_s ?? 0;
  const hi = edit.range_out_s ?? end;
  const step = STEPS.find((s) => s * px >= 70) ?? STEPS[STEPS.length - 1];
  const stillRows = stills.length ? 1 + (stillsOpen ? stills.length : 0) : 0;
  const bodyHeight =
    cameras.length * ROW.video + stillRows * ROW.still + audioRows.length * ROW.audio;

  const timeAt = (clientX: number) => {
    const rect = lanes.current?.getBoundingClientRect();
    return Math.min(end, Math.max(0, (clientX - (rect?.left ?? 0)) / px));
  };

  const down = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
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
          {cameras.map((c) => (
            <div
              key={c.item.id}
              class="flex items-center gap-2 border-t border-neutral-800 px-2 text-xs"
              style={{ height: ROW.video }}
            >
              <ChannelButton channel={c} onClick={() => props.onCamera(c.item.id)} />
              <span class="truncate">{c.item.label}</span>
            </div>
          ))}
          {stills.length > 0 && (
            <>
              <div
                class="flex items-center gap-1 border-t border-neutral-800 px-2 text-xs text-neutral-400"
                style={{ height: ROW.still }}
              >
                <button
                  class="flex items-center gap-1 hover:text-neutral-200"
                  aria-expanded={stillsOpen}
                  onClick={() => setStillsChoice(!stillsOpen)}
                >
                  <span aria-hidden="true">{stillsOpen ? "▾" : "▸"}</span>
                  Stills ({stills.length})
                </button>
              </div>
              {stillsOpen &&
                stills.map((c) => (
                  <div
                    key={c.item.id}
                    class="flex items-center gap-2 border-t border-neutral-800 px-2 text-xs"
                    style={{ height: ROW.still }}
                  >
                    <ChannelButton channel={c} onClick={() => props.onCamera(c.item.id)} />
                    <span class="truncate">{c.item.label}</span>
                  </div>
                ))}
            </>
          )}
          {audioRows.map((m) => {
            const t = tracks.find((tr) => tr.media_id === m.id)!;
            return (
              <div
                key={m.id}
                class="border-t border-neutral-800 px-2 py-1 text-xs"
                style={{ height: ROW.audio }}
              >
                <div class="truncate" title={m.label}>
                  {m.label}
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

          {cameras.map(({ item: m }) => {
            const off = offsets[m.id] ?? 0;
            return (
              <div
                key={m.id}
                class="relative border-t border-neutral-800"
                style={{ height: ROW.video }}
              >
                {band([off, off + (m.duration_s ?? 0)], "bg-neutral-700/60", "avail", 6, "22px")}
                {channelSpans(edit.switches, m.id, fallback, lo, hi).map((span, i) =>
                  band(span, channelStyle("video").span, i, 6, "22px"),
                )}
              </div>
            );
          })}

          {stills.length > 0 && (
            <>
              <div class="relative border-t border-neutral-800" style={{ height: ROW.still }}>
                {!stillsOpen &&
                  stills.flatMap(({ item: m }) =>
                    channelSpans(edit.switches, m.id, fallback, lo, hi).map((span, i) =>
                      band(span, channelStyle("image").span, `${m.id}-${i}`, 4, "20px"),
                    ),
                  )}
              </div>
              {stillsOpen &&
                stills.map(({ item: m }) => (
                  <div
                    key={m.id}
                    class="relative border-t border-neutral-800"
                    style={{ height: ROW.still }}
                  >
                    {channelSpans(edit.switches, m.id, fallback, lo, hi).map((span, i) =>
                      band(span, channelStyle("image").span, i, 4, "20px"),
                    )}
                  </div>
                ))}
            </>
          )}

          {audioRows.map((m) => (
            <div
              key={m.id}
              class="relative border-t border-neutral-800"
              style={{ height: ROW.audio }}
            >
              <Waveform
                peaks={peaks[m.id]}
                offset={offsets[m.id] ?? 0}
                pxPerSec={px}
                width={total}
                height={ROW.audio}
                color={AUDIO_WAVEFORM}
              />
              {edit.mix
                .filter((r) => r.media_id === m.id)
                .map((r, i) => (
                  <div
                    key={`mix${i}`}
                    class={`pointer-events-none absolute inset-y-0 overflow-hidden px-1 text-[10px] font-semibold ${
                      r.muted
                        ? "bg-red-950/80 text-red-200 ring-1 ring-red-700"
                        : "bg-amber-400/25 text-amber-200 ring-1 ring-amber-400"
                    }`}
                    style={{ left: x(r.start_s), width: Math.max(2, x(r.end_s - r.start_s)) }}
                    title={r.muted ? "Muted" : `${r.gain_db > 0 ? "+" : ""}${r.gain_db} dB`}
                  >
                    {r.muted ? "muted" : `${r.gain_db > 0 ? "+" : ""}${r.gain_db} dB`}
                  </div>
                ))}
            </div>
          ))}

          {lo > 0 && band([0, lo], "bg-black/50", "in", ROW.ruler, `${bodyHeight}px`)}
          {hi < end && band([hi, end], "bg-black/50", "out", ROW.ruler, `${bodyHeight}px`)}
          {edit.cuts.map((c, i) => {
            const live = edgeDrag?.index === i ? edgeDrag : null;
            const start = live?.edge === "start" ? live.value : c.start_s;
            const stop = live?.edge === "end" ? live.value : c.end_s;
            const handle = (edge: "start" | "end") => (
              <div
                role="separator"
                aria-label={`Drag the ${edge} of the cut`}
                title="Drag to adjust"
                class={`absolute inset-y-0 z-10 w-2 cursor-ew-resize hover:bg-red-300/60 ${edge === "start" ? "-left-1" : "-right-1"} ${live?.edge === edge ? "bg-red-300/70" : ""}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  setEdgeDrag({ index: i, edge, value: edge === "start" ? c.start_s : c.end_s });
                }}
                onPointerMove={(e) => {
                  if (edgeDrag?.index !== i || edgeDrag.edge !== edge) return;
                  e.stopPropagation();
                  const t = timeAt(e.clientX);
                  const value =
                    edge === "start"
                      ? Math.min(t, c.end_s - MIN_CUT_S)
                      : Math.max(t, c.start_s + MIN_CUT_S);
                  setEdgeDrag({ index: i, edge, value: Math.max(0, Math.min(end, value)) });
                }}
                onPointerUp={(e) => {
                  if (edgeDrag?.index !== i || edgeDrag.edge !== edge) return;
                  e.stopPropagation();
                  props.onCutChange?.(
                    i,
                    edge === "start" ? edgeDrag.value : c.start_s,
                    edge === "end" ? edgeDrag.value : c.end_s,
                  );
                  setEdgeDrag(null);
                }}
              />
            );
            return (
              <div
                key={`cut${i}`}
                class="absolute"
                style={{
                  left: x(start),
                  width: Math.max(1, x(stop - start)),
                  top: ROW.ruler,
                  height: bodyHeight,
                }}
              >
                <div class="pointer-events-none absolute inset-0 bg-red-600/40 ring-1 ring-red-500" />
                {handle("start")}
                {handle("end")}
                {live && (
                  <div
                    class="pointer-events-none absolute -top-5 z-20 whitespace-nowrap rounded bg-black/80 px-1 text-[10px] text-red-200"
                    style={live.edge === "start" ? { left: 0 } : { right: 0 }}
                  >
                    {formatTime(live.value, 2)}
                  </div>
                )}
              </div>
            );
          })}
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
            class="pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-amber-400"
            style={{ left: x(playhead) }}
            data-testid="playhead"
          />
        </div>
      </div>
    </div>
  );
}

function ChannelButton({ channel, onClick }: { channel: Channel; onClick: () => void }) {
  return (
    <ChannelChip
      kind={channel.item.kind as "video" | "image"}
      number={channel.number}
      title={`Switch to ${channel.item.label}${channel.number ? ` (${channel.number})` : ""}`}
      ariaLabel={`Switch to ${channel.item.label}`}
      onClick={onClick}
    />
  );
}

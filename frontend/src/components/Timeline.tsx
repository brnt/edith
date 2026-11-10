import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";

import type { EditList, MediaItem, Peaks } from "../lib/api";
import {
  channelsOf,
  defaultCamera,
  effectiveTracks,
  boundaryPreview,
  formatTime,
  movedSwitches,
  segments,
  TIMELINE_LABEL_W as LABEL_W,
  type Channel,
  type Picked,
  type Preview,
  type Range,
  type Segment,
} from "../lib/timeline";
import { AUDIO_WAVEFORM, channelStyle } from "../lib/channelStyle";
import { ChannelChip } from "./ChannelChip";
import { MAX_CANVAS_PX, Waveform } from "./Waveform";
import { Icon } from "./Icon";
import { CaretDown, CaretRight, Holder } from "./icons";

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
  /** Controls for the empty top-left corner (zoom). */
  corner?: ComponentChildren;
  /** A cut's edges were dragged: its index and its new start and end. */
  onCutChange?: (index: number, start_s: number, end_s: number) => void;
  /** A segment or cut is selected (click it): only a selected one can be dragged. */
  picked: Picked | null;
  onPick: (picked: Picked | null) => void;
  /** A selected segment's edge was dragged: the switch that starts the segment on that edge, and its new time. */
  onSegmentEdge?: (switchIndex: number, at_s: number) => void;
  /** While an edge is dragged, the playhead follows it so the frame at the edge can be checked. */
  onScrub?: (t: number) => void;
  /** What the preview shows while an edge is dragged (null when no drag). */
  onPreview?: (preview: Preview | null) => void;
}

const MIN_CUT_S = 0.1; // a dragged edge cannot squeeze a cut below this
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

export function Timeline(props: Props) {
  const { media, offsets, edit, peaks, playhead, end, selection, suggestions } = props;
  const px = Math.min(props.pxPerSec, MAX_CANVAS_PX / Math.max(end, 1));
  const total = Math.max(end * px, 1);
  const lanes = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; t: number; moved: boolean; target: EventTarget | null } | null>(
    null,
  );
  // An edge being dragged: shown live, committed once on release (one undo step).
  const [edgeDrag, setEdgeDrag] = useState<{
    index: number;
    edge: "start" | "end";
    value: number;
  } | null>(null);
  // One frame: the playhead sits on the *last* frame of the thing whose end edge is dragged.
  const frameS = edit.fps_den / edit.fps_num;
  const [segDrag, setSegDrag] = useState<{ index: number; value: number } | null>(null);
  const { picked } = props;

  const channels = channelsOf(media, edit.disabled);
  // A disabled channel stays on the timeline (the edit may use it), but dimmed.
  const dim = (c: Channel) => (c.enabled ? "" : "opacity-50");
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
    drag.current = { x: e.clientX, t: timeAt(e.clientX), moved: false, target: e.target };
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
      // A click on a segment or a cut selects it; anywhere else it moves the playhead.
      const hit = (d.target as HTMLElement | null)?.closest?.("[data-pick]") as HTMLElement | null;
      if (hit) {
        props.onPick({
          kind: hit.dataset.pick as Picked["kind"],
          index: Number(hit.dataset.index),
        });
      } else {
        props.onSeek(timeAt(e.clientX));
        props.onPick(null);
      }
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

  // Segments, with a dragged edge shown live (the neighbour on the other side of it follows).
  const live = segDrag
    ? movedSwitches(edit.switches, segDrag.index, segDrag.value, end)
    : edit.switches;
  const segs = segments(live, fallback, end);
  const switchCount = edit.switches.length;

  /** Move the playhead and the preview to show the boundary being dragged (see boundaryPreview). */
  const preview = (switchIndex: number, edge: "start" | "end", value: number) => {
    const moved = movedSwitches(edit.switches, switchIndex, value, end);
    const at = moved[switchIndex].at_s;
    const around = segments(moved, fallback, end);
    const kindOf = (id: string) => media.find((m) => m.id === id)?.kind;
    const { t, compare } = boundaryPreview({
      before: around.find((g) => g.index === switchIndex - 1)?.channel ?? fallback,
      after: around.find((g) => g.index === switchIndex)?.channel ?? null,
      at,
      // The handle on a segment's start edge resizes the segment after the boundary.
      resizing: edge === "start" ? "after" : "before",
      isVideo: (id) => kindOf(id) === "video",
      frameS,
    });
    props.onScrub?.(t);
    props.onPreview?.({ edit: { ...edit, switches: moved }, compare });
  };

  const segHandle = (switchIndex: number, edge: "start" | "end", at: number) => (
    <div
      role="separator"
      aria-label={`Drag the ${edge} of the segment`}
      title="Drag to adjust"
      class={`absolute inset-y-0 z-10 w-2 cursor-ew-resize hover:bg-white/50 ${edge === "start" ? "-left-1" : "-right-1"}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setSegDrag({ index: switchIndex, value: at });
        preview(switchIndex, edge, at);
      }}
      onPointerMove={(e) => {
        if (segDrag?.index !== switchIndex) return;
        e.stopPropagation();
        const value = timeAt(e.clientX);
        setSegDrag({ index: switchIndex, value });
        preview(switchIndex, edge, value);
      }}
      onPointerUp={(e) => {
        if (segDrag?.index !== switchIndex) return;
        e.stopPropagation();
        const at_s = movedSwitches(edit.switches, switchIndex, segDrag.value, end)[switchIndex]
          .at_s;
        props.onSegmentEdge?.(switchIndex, at_s);
        setSegDrag(null);
        props.onPreview?.(null);
      }}
    />
  );

  const segmentBox = (seg: Segment, kind: "video" | "image", top: number, height: number) => {
    const from = Math.max(seg.start, lo);
    const to = Math.min(seg.end, hi);
    if (to <= from) return null;
    const on = picked?.kind === "segment" && picked.index === seg.index;
    // An edge can be dragged when it is a switch (not the start of the timeline or the end of the clip).
    const canStart = seg.index >= 0 && seg.start >= lo;
    const canEnd = seg.index + 1 < switchCount && seg.end <= hi;
    return (
      <div
        key={`seg${seg.index}`}
        data-pick="segment"
        data-index={seg.index}
        data-testid="segment"
        aria-selected={on}
        title={on ? undefined : "Click to select"}
        class={`absolute cursor-pointer ${channelStyle(kind).span} ${on ? "border-x-2 border-y border-white" : "hover:brightness-125"}`}
        style={{ left: x(from), width: Math.max(1, x(to - from)), top, height }}
      >
        {on && canStart && segHandle(seg.index, "start", seg.start)}
        {on && canEnd && segHandle(seg.index + 1, "end", seg.end)}
        {/* Grips inside the extremes say the edges (not the whole segment) can be dragged; they are
            shifted so the outer column of dots is centred on the 2px side border (the glyph has padding). */}
        {on && canStart && (
          <span
            data-grip="start"
            class="pointer-events-none absolute inset-y-0 -left-[0.41em] flex items-center text-xs text-neutral-700/50"
          >
            <Icon icon={Holder} />
          </span>
        )}
        {on && canEnd && (
          <span
            data-grip="end"
            class="pointer-events-none absolute inset-y-0 -right-[0.38em] flex items-center text-xs text-neutral-700/50"
          >
            <Icon icon={Holder} />
          </span>
        )}
        {on && segDrag && (segDrag.index === seg.index || segDrag.index === seg.index + 1) && (
          <div
            class="pointer-events-none absolute -top-5 z-20 whitespace-nowrap rounded bg-black/80 px-1 text-[10px] text-white"
            style={segDrag.index === seg.index ? { left: 0 } : { right: 0 }}
          >
            {formatTime(segDrag.index === seg.index ? seg.start : seg.end, 2)}
          </div>
        )}
      </div>
    );
  };

  const ticks: number[] = [];
  for (let t = 0; t <= end; t += step) ticks.push(t);

  return (
    <div
      class="overflow-x-auto rounded border border-neutral-800 bg-neutral-900"
      data-testid="timeline"
    >
      <div class="flex" style={{ width: LABEL_W + total }}>
        <div class="sticky left-0 z-20 bg-neutral-900" style={{ width: LABEL_W }}>
          <div class="flex items-center gap-1 px-1" style={{ height: ROW.ruler }}>
            {props.corner}
          </div>
          {cameras.map((c) => (
            <div
              key={c.item.id}
              class={`flex items-center gap-2 border-t border-neutral-800 px-2 text-xs ${dim(c)}`}
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
                  <Icon icon={stillsOpen ? CaretDown : CaretRight} />
                  Stills ({stills.length})
                </button>
              </div>
              {stillsOpen &&
                stills.map((c) => (
                  <div
                    key={c.item.id}
                    class={`flex items-center gap-2 border-t border-neutral-800 px-2 text-xs ${dim(c)}`}
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

          {cameras.map((c) => {
            const m = c.item;
            const off = offsets[m.id] ?? 0;
            return (
              <div
                key={m.id}
                class={`relative border-t border-neutral-800 ${dim(c)}`}
                style={{ height: ROW.video }}
              >
                {band([off, off + (m.duration_s ?? 0)], "bg-neutral-700/60", "avail", 6, "22px")}
                {segs.filter((g) => g.channel === m.id).map((g) => segmentBox(g, "video", 6, 22))}
              </div>
            );
          })}

          {stills.length > 0 && (
            <>
              <div class="relative border-t border-neutral-800" style={{ height: ROW.still }}>
                {!stillsOpen &&
                  segs
                    .filter((g) => stills.some((c) => c.item.id === g.channel))
                    .map((g) => segmentBox(g, "image", 4, 20))}
              </div>
              {stillsOpen &&
                stills.map((c) => (
                  <div
                    key={c.item.id}
                    class={`relative border-t border-neutral-800 ${dim(c)}`}
                    style={{ height: ROW.still }}
                  >
                    {segs
                      .filter((g) => g.channel === c.item.id)
                      .map((g) => segmentBox(g, "image", 4, 20))}
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
            const on = picked?.kind === "cut" && picked.index === i;
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
                  const at = edge === "start" ? c.start_s : c.end_s;
                  setEdgeDrag({ index: i, edge, value: at });
                  props.onScrub?.(edge === "end" ? Math.max(0, at - frameS) : at);
                }}
                onPointerMove={(e) => {
                  if (edgeDrag?.index !== i || edgeDrag.edge !== edge) return;
                  e.stopPropagation();
                  const t = timeAt(e.clientX);
                  const value =
                    edge === "start"
                      ? Math.min(t, c.end_s - MIN_CUT_S)
                      : Math.max(t, c.start_s + MIN_CUT_S);
                  const clamped = Math.max(0, Math.min(end, value));
                  setEdgeDrag({ index: i, edge, value: clamped });
                  props.onScrub?.(edge === "end" ? Math.max(0, clamped - frameS) : clamped);
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
                data-pick="cut"
                data-index={i}
                data-testid="cut"
                aria-selected={on}
                title={on ? undefined : "Click to select"}
                class="absolute cursor-pointer"
                style={{
                  left: x(start),
                  width: Math.max(1, x(stop - start)),
                  top: ROW.ruler,
                  height: bodyHeight,
                }}
              >
                <div
                  class={`pointer-events-none absolute inset-0 bg-red-600/40 ${on ? "ring-2 ring-white" : "ring-1 ring-red-500"}`}
                />
                {on && handle("start")}
                {on && handle("end")}
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
  if (!channel.enabled) {
    return (
      <span
        class="min-w-5 rounded bg-neutral-800 px-1.5 text-center text-neutral-500"
        title="Disabled in the Media tab: not in the grid and not numbered"
        aria-label={`${channel.item.label} is disabled`}
      >
        –
      </span>
    );
  }
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

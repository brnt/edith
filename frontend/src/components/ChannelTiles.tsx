import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { proxyUrl, thumbUrl, type MediaItem } from "../lib/api";
import { channelStyle } from "../lib/channelStyle";
import { KEYPAD_COLS, keypadCell, keypadRows, overflowCell, tileWidth } from "../lib/keypad";
import { formatTime, type Channel, type Range } from "../lib/timeline";
import { MissingFlag } from "./MissingFlag";

type Cell = { row: number; col: number };
/** Put a tile in its keypad cell (a style, so the DOM stays a flat list in number order). */
const cellStyle = (cell?: Cell) => (cell ? { gridRow: cell.row, gridColumn: cell.col } : undefined);

const TILE_GAP = 8; // gap-2, in pixels: the keypad's tile sizing needs it
const TILE_W = 320; // canvas pixels; shown smaller, so it stays sharp
const TILE_H = 180;

/** Draw the video's current frame, fitted inside the canvas on black. */
export function paintFrame(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { videoWidth: vw, videoHeight: vh } = video;
  if (!vw || !vh) return;
  const scale = Math.min(canvas.width / vw, canvas.height / vh);
  const w = vw * scale;
  const h = vh * scale;
  ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

const kindOf = (channel: Channel): "video" | "image" =>
  channel.item.kind === "image" ? "image" : "video";

/** The channel number (top-left, in its own color: blue camera, teal still) and its name (bottom-left, dark and legible). */
function TileLabel({ channel }: { channel: Channel }) {
  const bg = channelStyle(kindOf(channel)).chip.split(" ")[0];
  return (
    <>
      {channel.number !== null && (
        <span
          class={`absolute left-1 top-1 rounded px-1.5 text-[11px] font-semibold text-white ${bg}`}
        >
          {channel.number}
        </span>
      )}
      <span class="absolute bottom-0 left-0 max-w-full truncate rounded-tr bg-neutral-950/65 px-1.5 text-[11px] text-neutral-100">
        {channel.item.label}
      </span>
    </>
  );
}

const TILE_BASE = "group relative block aspect-video w-full overflow-hidden rounded bg-black";

/** The tile's frame: a button that cuts to the channel, or (when it is the one on screen) a highlighted, inert copy. */
function TileShell({
  channel,
  active,
  selection,
  cell,
  onActivate,
  onShowProblem,
  children,
}: {
  channel: Channel;
  active: boolean;
  selection: Range | null;
  /** Its cell in the keypad grid. */
  cell?: Cell;
  onActivate: () => void;
  /** The tile's problem flag was clicked. */
  onShowProblem?: () => void;
  children: ComponentChildren;
}) {
  const still = kindOf(channel) === "image";
  const name = `${still ? "still" : "camera"} ${channel.number ?? channel.item.label}`;
  if (active) {
    return (
      <div
        role="group"
        aria-label={`${name[0].toUpperCase()}${name.slice(1)} is on screen`}
        data-testid="tile-active"
        class={TILE_BASE}
        style={cellStyle(cell)}
      >
        <div class="h-full w-full opacity-40">{children}</div>
        <span class="absolute inset-0 flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-white">
          on screen
        </span>
        <MissingFlag
          item={channel.item}
          onShow={onShowProblem}
          class="absolute right-1 top-1 z-10"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      class={`${TILE_BASE} hover:ring-2 focus-visible:ring-2 ${still ? "hover:ring-teal-400 focus-visible:ring-teal-400" : "hover:ring-sky-400 focus-visible:ring-sky-400"}`}
      aria-label={`Preview of ${name}: switch to it`}
      title={
        selection
          ? `Show ${channel.item.label} over ${formatTime(selection[0], 2)} – ${formatTime(selection[1], 2)}, then go back`
          : `Switch to ${channel.item.label}${channel.number ? ` (${channel.number})` : ""} at the playhead`
      }
      onClick={onActivate}
      style={cellStyle(cell)}
    >
      {children}
      <MissingFlag item={channel.item} onShow={onShowProblem} class="absolute right-1 top-1 z-10" />
    </button>
  );
}

interface TileProps {
  channel: Channel;
  elements: { current: Record<string, HTMLMediaElement | null> };
  hasFootage: boolean;
  proxyReady: boolean;
  active?: boolean;
  selection?: Range | null;
  cell?: Cell;
  onActivate: () => void;
  onShowProblem?: () => void;
}

/**
 * A small live view of one camera. It paints frames from the camera's own (hidden) player element,
 * so it is in step with the playhead by construction: no second copy of the video is decoded.
 */
export function CameraTile({
  channel,
  elements,
  hasFootage,
  proxyReady,
  active = false,
  selection = null,
  cell,
  onActivate,
  onShowProblem,
}: TileProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const attached = useRef<{ el: HTMLMediaElement; off: () => void } | null>(null);
  const repaint = useRef(() => {});
  const item: MediaItem = channel.item;

  repaint.current = () => {
    const el = elements.current[item.id] as HTMLVideoElement | null | undefined;
    if (!canvas.current || !el) return;
    if (!hasFootage || el.readyState < 2) {
      // Nothing to show: clear to black (the overlay says why).
      if (!hasFootage)
        paintFrame(canvas.current, { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement);
      return;
    }
    paintFrame(canvas.current, el);
  };

  // Runs after every render (the playhead moves every frame while playing). It also follows the
  // camera's element if it appears later, and repaints when a seek lands while paused.
  useEffect(() => {
    const el = elements.current[item.id] ?? null;
    if (el && attached.current?.el !== el) {
      attached.current?.off();
      const paint = () => repaint.current();
      el.addEventListener("seeked", paint);
      el.addEventListener("loadeddata", paint);
      attached.current = {
        el,
        off: () => {
          el.removeEventListener("seeked", paint);
          el.removeEventListener("loadeddata", paint);
        },
      };
    }
    repaint.current();
  });

  useEffect(() => () => attached.current?.off(), []);

  return (
    <TileShell
      channel={channel}
      active={active}
      selection={selection}
      cell={cell}
      onActivate={onActivate}
      onShowProblem={onShowProblem}
    >
      <canvas ref={canvas} width={TILE_W} height={TILE_H} class="h-full w-full" />
      {(!hasFootage || !proxyReady) && (
        <span class="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
          {proxyReady ? "no footage yet" : "no proxy"}
        </span>
      )}
      <TileLabel channel={channel} />
    </TileShell>
  );
}

/** A still, as a small picture (its proxy when built, else the little thumbnail). */
export function StillTile({
  channel,
  slug,
  active = false,
  selection = null,
  cell,
  onActivate,
  onShowProblem,
}: {
  channel: Channel;
  slug: string;
  active?: boolean;
  selection?: Range | null;
  cell?: Cell;
  onActivate: () => void;
  onShowProblem?: () => void;
}) {
  const item = channel.item;
  return (
    <TileShell
      channel={channel}
      active={active}
      selection={selection}
      cell={cell}
      onActivate={onActivate}
      onShowProblem={onShowProblem}
    >
      <img
        src={item.proxy_ready ? proxyUrl(slug, item.id) : thumbUrl(slug, item.id)}
        alt=""
        loading="lazy"
        class="h-full w-full object-contain"
      />
      <TileLabel channel={channel} />
    </TileShell>
  );
}

/**
 * Every camera and still, each in a fixed slot (cameras by number, then stills). The one on screen
 * is a highlighted, live copy that can't be clicked, so switching never re-orders the grid.
 */
/**
 * Every enabled camera and still, laid out like a numeric keypad (7 8 9 / 4 5 6 / 1 2 3), so a
 * channel's number key is where its thumbnail is. Each keeps a fixed cell (so switching never
 * re-orders the grid); the one on screen is a dimmed live copy. Tiles are sized so the whole keypad
 * fits the room without scrolling. Channels beyond the nine numbers follow below.
 */
export function ChannelTiles({
  slug,
  channels,
  activeId,
  elements,
  local,
  selection = null,
  onActivate,
  onShowProblem,
}: {
  slug: string;
  channels: Channel[];
  activeId: string | null;
  elements: TileProps["elements"];
  /** Local file time per media id, or null when that camera has no footage at the playhead. */
  local: Record<string, number | null>;
  /** The range selected on the timeline: a click then shows the channel over just that range. */
  selection?: Range | null;
  onActivate: (mediaId: string) => void;
  /** A tile's "can't read this file" flag was clicked. */
  onShowProblem?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const enabled = channels.filter((c) => c.enabled);
  const numbered = enabled.filter((c) => c.number !== null);
  const loose = enabled.filter((c) => c.number === null);
  const rows = keypadRows(Math.max(0, ...numbered.map((c) => c.number ?? 0)));
  const totalRows = rows + Math.ceil(loose.length / KEYPAD_COLS);
  const width = room ? tileWidth(room.w, room.h, totalRows, TILE_GAP) : 0;

  const cellOf = (c: Channel) =>
    c.number !== null ? keypadCell(c.number, rows) : overflowCell(loose.indexOf(c), rows);

  return (
    <div
      ref={box}
      class="grid h-full min-w-0 flex-1 content-start justify-start gap-2"
      style={{
        // Until the room is measured, share the width; then fixed tiles that fit the height.
        gridTemplateColumns: `repeat(${KEYPAD_COLS}, ${width ? `${width}px` : "minmax(0, 1fr)"})`,
      }}
      data-testid="channel-tiles"
    >
      {[...numbered, ...loose].map((c) => {
        const active = c.item.id === activeId;
        const cell = cellOf(c);
        if (c.item.kind === "image") {
          return (
            <StillTile
              key={c.item.id}
              channel={c}
              slug={slug}
              active={active}
              selection={selection}
              cell={cell}
              onActivate={() => onActivate(c.item.id)}
              onShowProblem={onShowProblem}
            />
          );
        }
        return (
          <CameraTile
            key={c.item.id}
            channel={c}
            elements={elements}
            hasFootage={local[c.item.id] !== null && local[c.item.id] !== undefined}
            proxyReady={c.item.proxy_ready}
            active={active}
            selection={selection}
            cell={cell}
            onActivate={() => onActivate(c.item.id)}
            onShowProblem={onShowProblem}
          />
        );
      })}
    </div>
  );
}

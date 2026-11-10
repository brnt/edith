import { useEffect, useRef } from "preact/hooks";

import { proxyUrl, thumbUrl, type MediaItem } from "../lib/api";
import { channelStyle } from "../lib/channelStyle";
import type { Channel } from "../lib/timeline";
import { Icon } from "./Icon";
import { Picture, VideoCamera } from "./icons";

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

/** The number and name on a tile, in the channel's own color (blue camera, teal still). */
function TileLabel({ channel, dim = false }: { channel: Channel; dim?: boolean }) {
  const bg = channelStyle(kindOf(channel)).chip.split(" ")[0];
  return (
    <span
      class={`absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded px-1.5 text-[11px] text-white ${bg} ${dim ? "opacity-60" : ""}`}
    >
      <span class="font-semibold">{channel.number ?? "•"}</span>
      <span class="truncate">{channel.item.label}</span>
    </span>
  );
}

const TILE =
  "group relative aspect-video w-full overflow-hidden rounded bg-black ring-1 ring-neutral-700 hover:ring-2 focus-visible:ring-2";

interface TileProps {
  channel: Channel;
  elements: { current: Record<string, HTMLMediaElement | null> };
  hasFootage: boolean;
  proxyReady: boolean;
  onActivate: () => void;
}

/**
 * A small live view of one camera. It paints frames from the camera's own (hidden) player element,
 * so it is in step with the playhead by construction: no second copy of the video is decoded.
 */
export function CameraTile({ channel, elements, hasFootage, proxyReady, onActivate }: TileProps) {
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
    <button
      type="button"
      class={`${TILE} hover:ring-sky-400 focus-visible:ring-sky-400`}
      aria-label={`Preview of camera ${channel.number ?? item.label}: switch to it`}
      title={`Switch to ${item.label}${channel.number ? ` (${channel.number})` : ""} at the playhead`}
      onClick={onActivate}
    >
      <canvas ref={canvas} width={TILE_W} height={TILE_H} class="h-full w-full" />
      {(!hasFootage || !proxyReady) && (
        <span class="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
          {proxyReady ? "no footage yet" : "no proxy"}
        </span>
      )}
      <TileLabel channel={channel} />
    </button>
  );
}

/** A still, as a small picture (its proxy when built, else the little thumbnail). */
export function StillTile({
  channel,
  slug,
  onActivate,
}: {
  channel: Channel;
  slug: string;
  onActivate: () => void;
}) {
  const item = channel.item;
  return (
    <button
      type="button"
      class={`${TILE} hover:ring-teal-400 focus-visible:ring-teal-400`}
      aria-label={`Preview of still ${channel.number ?? item.label}: switch to it`}
      title={`Switch to ${item.label}${channel.number ? ` (${channel.number})` : ""} at the playhead`}
      onClick={onActivate}
    >
      <img
        src={item.proxy_ready ? proxyUrl(slug, item.id) : thumbUrl(slug, item.id)}
        alt=""
        loading="lazy"
        class="h-full w-full object-contain"
      />
      <TileLabel channel={channel} />
    </button>
  );
}

/** The slot of the channel that is on screen: held empty so the other tiles never move. */
export function TilePlaceholder({ channel }: { channel: Channel }) {
  const still = kindOf(channel) === "image";
  return (
    <div
      role="group"
      aria-label={`${still ? "Still" : "Camera"} ${channel.number ?? channel.item.label} is on screen`}
      data-testid="tile-placeholder"
      class={`relative flex aspect-video w-full items-center justify-center rounded border-2 border-dashed bg-neutral-900/40 text-xs ${still ? "border-teal-500/50 text-teal-300/80" : "border-sky-500/50 text-sky-300/80"}`}
    >
      <span class="inline-flex items-center gap-1">
        <Icon icon={still ? Picture : VideoCamera} />
        on screen
      </span>
      <TileLabel channel={channel} dim />
    </div>
  );
}

/**
 * Every camera and still, each in a fixed slot (cameras by number, then stills). The one on screen
 * is a placeholder, so switching changes what is in two slots but never re-orders the grid.
 */
export function ChannelTiles({
  slug,
  channels,
  activeId,
  elements,
  local,
  onActivate,
}: {
  slug: string;
  channels: Channel[];
  activeId: string | null;
  elements: TileProps["elements"];
  /** Local file time per media id, or null when that camera has no footage at the playhead. */
  local: Record<string, number | null>;
  onActivate: (mediaId: string) => void;
}) {
  return (
    <div
      class="grid h-full min-w-0 flex-1 content-start gap-2 overflow-y-auto"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}
      data-testid="channel-tiles"
    >
      {channels
        .filter((c) => c.enabled)
        .map((c) => {
          if (c.item.id === activeId) return <TilePlaceholder key={c.item.id} channel={c} />;
          if (c.item.kind === "image") {
            return (
              <StillTile
                key={c.item.id}
                channel={c}
                slug={slug}
                onActivate={() => onActivate(c.item.id)}
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
              onActivate={() => onActivate(c.item.id)}
            />
          );
        })}
    </div>
  );
}

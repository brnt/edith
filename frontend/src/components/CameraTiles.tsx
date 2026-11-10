import { useEffect, useRef } from "preact/hooks";

import type { MediaItem } from "../lib/api";
import { CHANNEL_STYLE } from "../lib/channelStyle";
import type { Channel } from "../lib/timeline";
import { Icon } from "./Icon";
import { VideoCamera } from "./icons";

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
      class="group relative aspect-video w-full overflow-hidden rounded bg-black ring-1 ring-neutral-700 hover:ring-2 hover:ring-sky-400 focus-visible:ring-2 focus-visible:ring-sky-400"
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
      <span
        class={`absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded px-1.5 text-[11px] text-white ${CHANNEL_STYLE.video.chip.split(" ")[0]}`}
      >
        <span class="font-semibold">{channel.number ?? "•"}</span>
        <span class="truncate">{item.label}</span>
      </span>
    </button>
  );
}

/** The slot of the camera that is on screen: held empty so the other tiles never move. */
export function TilePlaceholder({ channel }: { channel: Channel }) {
  return (
    <div
      role="group"
      aria-label={`Camera ${channel.number ?? channel.item.label} is on screen`}
      data-testid="tile-placeholder"
      class="relative flex aspect-video w-full items-center justify-center rounded border-2 border-dashed border-sky-500/50 bg-neutral-900/40 text-xs text-sky-300/80"
    >
      <span class="inline-flex items-center gap-1">
        <Icon icon={VideoCamera} />
        on screen
      </span>
      <span
        class={`absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded px-1.5 text-[11px] text-white opacity-60 ${CHANNEL_STYLE.video.chip.split(" ")[0]}`}
      >
        <span class="font-semibold">{channel.number ?? "•"}</span>
        <span class="truncate">{channel.item.label}</span>
      </span>
    </div>
  );
}

/**
 * Every camera, each in a fixed slot (by camera number). The one on screen is a placeholder, so
 * switching cameras changes what is in two slots but never re-orders the grid.
 */
export function CameraTiles({
  channels,
  activeId,
  elements,
  local,
  onActivate,
}: {
  channels: Channel[];
  activeId: string | null;
  elements: TileProps["elements"];
  /** Local file time per media id, or null when that camera has no footage at `t`. */
  local: Record<string, number | null>;
  onActivate: (mediaId: string) => void;
}) {
  const cameras = channels.filter((c) => c.item.kind === "video");
  return (
    <div
      class="grid h-full min-w-0 flex-1 content-start gap-2 overflow-y-auto"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}
      data-testid="camera-tiles"
    >
      {cameras.map((c) =>
        c.item.id === activeId ? (
          <TilePlaceholder key={c.item.id} channel={c} />
        ) : (
          <CameraTile
            key={c.item.id}
            channel={c}
            elements={elements}
            hasFootage={local[c.item.id] !== null && local[c.item.id] !== undefined}
            proxyReady={c.item.proxy_ready}
            onActivate={() => onActivate(c.item.id)}
          />
        ),
      )}
    </div>
  );
}

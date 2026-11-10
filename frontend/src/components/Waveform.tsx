import { useEffect, useRef } from "preact/hooks";

import type { Peaks } from "../lib/api";
import { AUDIO_WAVEFORM } from "../lib/channelStyle";

interface Props {
  peaks: Peaks | undefined;
  /** Timeline position of the file's first sample, seconds. */
  offset?: number;
  pxPerSec: number;
  /** Total track width in px. */
  width: number;
  height: number;
  color?: string;
}

export const MAX_CANVAS_PX = 30000;

/** Loudness envelope drawn as vertical bars, one per pixel column. */
export function Waveform({
  peaks,
  offset = 0,
  pxPerSec,
  width,
  height,
  color = AUDIO_WAVEFORM,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!peaks) return;
    ctx.fillStyle = color;
    const perPx = peaks.rate / pxPerSec; // envelope values per pixel column
    for (let x = 0; x < width; x++) {
      const from = Math.floor((x / pxPerSec - offset) * peaks.rate);
      const to = Math.max(from + 1, Math.ceil(from + perPx));
      if (to < 0 || from >= peaks.values.length) continue;
      let max = 0;
      for (let i = Math.max(0, from); i < Math.min(to, peaks.values.length); i++) {
        if (peaks.values[i] > max) max = peaks.values[i];
      }
      const h = Math.max(max > 0 ? 1 : 0, (max / 255) * height);
      ctx.fillRect(x, (height - h) / 2, 1, h);
    }
  }, [peaks, offset, pxPerSec, width, height, color]);

  return <canvas ref={ref} width={Math.min(width, MAX_CANVAS_PX)} height={height} class="block" />;
}

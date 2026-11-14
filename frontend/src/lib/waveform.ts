// How loud a waveform looks. The peaks are in dB (0..255 across -80..0 dBFS), so a recording's
// background hiss, at -45 dBFS or so, would stand at over half the row's height. Each waveform is
// instead drawn from its own quiet level (its 10th percentile, kept between -70 and -30 dBFS)
// up to full scale: the background sits low, speech stands out, and a very quiet file still fills
// its row.

const LOWEST = Math.round(((-70 + 80) / 80) * 255); // -70 dBFS on the 0..255 scale
const HIGHEST = Math.round(((-30 + 80) / 80) * 255); // -30 dBFS
const QUIET_PERCENTILE = 0.1;

/** The value (0..255) a waveform is drawn up from: what counts as its background level. */
export function quietLevel(values: number[]): number {
  const counts = new Array<number>(256).fill(0);
  let n = 0;
  for (const v of values) {
    if (v > 0) {
      counts[v]++; // 0 is digital silence: not a background level
      n++;
    }
  }
  if (n === 0) return LOWEST;
  let seen = 0;
  for (let v = 1; v < 256; v++) {
    seen += counts[v];
    if (seen >= n * QUIET_PERCENTILE) return Math.max(LOWEST, Math.min(HIGHEST, v));
  }
  return HIGHEST;
}

/** A bar's height, 0..1, for a peak value when the waveform is drawn up from `quiet`. */
export function barHeight(value: number, quiet: number): number {
  return Math.max(0, (value - quiet) / (255 - quiet));
}

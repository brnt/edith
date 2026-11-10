// Human-readable pieces of a media file's technical details.
import type { MediaDetails, MediaItem } from "./api";

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i += 1;
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatBitrate(bps: number | null): string {
  if (bps === null) return "–";
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbps` : `${Math.round(bps / 1e3)} kbps`;
}

const CHANNELS: Record<number, string> = { 1: "mono", 2: "stereo" };

export interface DetailRow {
  label: string;
  value: string;
  /** Something worth noticing (variable frame rate, a mismatch with the project). */
  warn?: boolean;
}

export interface DetailSection {
  title: string;
  rows: DetailRow[];
}

/** The details popover's rows, grouped; `project` is the edit's frame rate, to flag a mismatch. */
export function detailSections(
  d: MediaDetails,
  item: MediaItem,
  project: { fps: number } | null,
): DetailSection[] {
  const sections: DetailSection[] = [];
  const file: DetailRow[] = [
    { label: "Container", value: d.container ?? "–" },
    { label: "Size", value: formatBytes(d.size_bytes) },
  ];
  if (d.duration_s !== null)
    file.push({ label: "Duration", value: `${d.duration_s.toFixed(2)} s` });
  if (d.bit_rate !== null) file.push({ label: "Bit rate", value: formatBitrate(d.bit_rate) });
  if (d.created) file.push({ label: "Created", value: d.created.replace("T", " ").slice(0, 19) });
  sections.push({ title: "File", rows: file });

  const v = d.video;
  if (v) {
    const rows: DetailRow[] = [
      { label: "Codec", value: [v.codec, v.profile].filter(Boolean).join(" · ") || "–" },
      { label: "Resolution", value: v.width ? `${v.width}×${v.height}` : "–" },
    ];
    if (v.fps) {
      const variable = v.fps_variable;
      const mismatch = project !== null && Math.abs(v.fps - project.fps) > 0.05;
      rows.push({
        label: "Frame rate",
        value: `${v.fps.toFixed(3).replace(/\.?0+$/, "")} fps${variable ? " (variable)" : ""}`,
        warn: variable || mismatch,
      });
    }
    const colour = [
      v.bit_depth ? `${v.bit_depth}-bit` : null,
      v.pix_fmt,
      v.color_space,
      v.color_range,
    ].filter(Boolean);
    if (colour.length) rows.push({ label: "Colour", value: colour.join(" · ") });
    if (v.bit_rate !== null) rows.push({ label: "Bit rate", value: formatBitrate(v.bit_rate) });
    sections.push({ title: "Video", rows });
  } else if (item.kind === "image" && item.width) {
    sections.push({
      title: "Picture",
      rows: [{ label: "Resolution", value: `${item.width}×${item.height}` }],
    });
  }

  const a = d.audio;
  if (a) {
    const rows: DetailRow[] = [{ label: "Codec", value: a.codec ?? "–" }];
    if (a.sample_rate) rows.push({ label: "Sample rate", value: `${a.sample_rate / 1000} kHz` });
    if (a.channels)
      rows.push({
        label: "Channels",
        value: CHANNELS[a.channels] ?? `${a.channels} channels`,
      });
    if (a.bit_depth) rows.push({ label: "Bit depth", value: `${a.bit_depth}-bit` });
    if (a.bit_rate !== null) rows.push({ label: "Bit rate", value: formatBitrate(a.bit_rate) });
    sections.push({ title: "Audio", rows });
  }
  return sections;
}

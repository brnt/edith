// Human-readable pieces of a media file's technical details.
import type { MediaDetails, MediaItem, SyncState } from "./api";

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
  project: ProjectFormat | null,
): DetailSection[] {
  const sections: DetailSection[] = [];
  const v = d.video;

  if (item.kind === "image") {
    // A still is described by its image format, not by the container ffprobe happens to name.
    const mismatch = d.image_extension_matches === false;
    const ext = item.label.includes(".") ? item.label.slice(item.label.lastIndexOf(".")) : "";
    const file: DetailRow[] = [
      { label: "Format", value: d.image_format ?? "–", warn: mismatch },
      { label: "Size", value: formatBytes(d.size_bytes) },
    ];
    if (mismatch)
      file.push({
        label: "Name",
        value: `${ext} in the name, but the file is ${d.image_format}`,
        warn: true,
      });
    if (d.created) file.push({ label: "Created", value: d.created.replace("T", " ").slice(0, 19) });
    sections.push({ title: "File", rows: file });
    const w = v?.width ?? item.width;
    const h = v?.height ?? item.height;
    const picture: DetailRow[] = [
      {
        label: "Resolution",
        value: w ? `${w}×${h}` : "–",
        warn: isLowRes(w, h, project) || undefined,
      },
    ];
    const colour = [v?.bit_depth ? `${v.bit_depth}-bit` : null, v?.pix_fmt, v?.color_space].filter(
      Boolean,
    );
    if (colour.length) picture.push({ label: "Colour", value: colour.join(" · ") });
    sections.push({ title: "Picture", rows: picture });
    return sections;
  }

  const file: DetailRow[] = [
    { label: "Container", value: d.container ?? "–" },
    { label: "Size", value: formatBytes(d.size_bytes) },
  ];
  if (d.duration_s !== null)
    file.push({ label: "Duration", value: `${d.duration_s.toFixed(2)} s` });
  if (d.bit_rate !== null) file.push({ label: "Bit rate", value: formatBitrate(d.bit_rate) });
  if (d.created) file.push({ label: "Created", value: d.created.replace("T", " ").slice(0, 19) });
  sections.push({ title: "File", rows: file });

  if (v) {
    const rows: DetailRow[] = [
      { label: "Codec", value: [v.codec, v.profile].filter(Boolean).join(" · ") || "–" },
      {
        label: "Resolution",
        value: v.width ? `${v.width}×${v.height}` : "–",
        warn: isLowRes(v.width, v.height, project) || undefined,
      },
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

/** The project's output format, for flagging files that don't match it. */
export interface ProjectFormat {
  fps: number;
  width?: number;
  height?: number;
}

/**
 * Would this picture be scaled up to fill the output? True when, fitted inside the output frame, it
 * ends up larger than it is (a portrait file in a landscape project is fitted by height, so it
 * counts only if that makes it bigger).
 */
export function isLowRes(
  width: number | null,
  height: number | null,
  project: ProjectFormat | null,
): boolean {
  if (!width || !height || !project?.width || !project.height) return false;
  return Math.min(project.width / width, project.height / height) > 1.01;
}

const lowResNote = (w: number, h: number, project: ProjectFormat) =>
  `${w}×${h} is smaller than the project's ${project.width}×${project.height}, so it will be scaled up and look soft`;

/** Things about a file worth a second look, for a note on its card. */
export function formatNotes(item: MediaItem, project: ProjectFormat | null): string[] {
  const notes: string[] = [];
  if (item.kind === "video" && item.fps && project && Math.abs(item.fps - project.fps) > 0.05) {
    notes.push(`${item.fps.toFixed(2)} fps, but the project is ${project.fps.toFixed(2)} fps`);
  }
  if (item.kind !== "audio" && project && isLowRes(item.width, item.height, project)) {
    notes.push(lowResNote(item.width!, item.height!, project));
  }
  if (item.kind !== "audio" && item.width && item.height && item.height > item.width) {
    notes.push("Portrait (vertical) picture");
  }
  return notes;
}

export type MediaFilter = "all" | "video" | "audio" | "image" | "new" | "unsynced";

/** Which media the media tab shows. "Unsynced": video and audio the sync hasn't placed. */
export function matchesFilter(m: MediaItem, filter: MediaFilter, sync: SyncState | null): boolean {
  switch (filter) {
    case "all":
      return true;
    case "new":
      return !m.included;
    case "unsynced":
      return m.included && m.kind !== "image" && sync?.results[m.id]?.status !== "synced";
    default:
      return m.kind === filter;
  }
}

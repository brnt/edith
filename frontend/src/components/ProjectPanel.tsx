import type { EditList, MediaItem } from "../lib/api";
import { isLowRes } from "../lib/mediaInfo";
import { Icon } from "./Icon";
import { Warning } from "./icons";
import { RibbonCell, RibbonGroup, RibbonNumber, RibbonSet } from "./RibbonGrid";
import { Select } from "./ui";

/** Common sizes, for the quick picker. Any size can still be typed. */
const SIZES: { w: number; h: number; name: string }[] = [
  { w: 1280, h: 720, name: "HD 720" },
  { w: 1920, h: 1080, name: "Full HD" },
  { w: 2560, h: 1440, name: "QHD" },
  { w: 3840, h: 2160, name: "4K UHD" },
  { w: 4096, h: 2160, name: "DCI 4K" },
  { w: 1080, h: 1920, name: "Vertical" },
  { w: 1080, h: 1080, name: "Square" },
];

/** The output formats a render can be encoded as (the backend's `ENCODINGS`), with their container. */
export const ENCODINGS: Record<string, { label: string; container: string; hint: string }> = {
  h264: { label: "H.264", container: "MP4", hint: "Small and plays anywhere" },
  h265: {
    label: "H.265",
    container: "MP4",
    hint: "About half the size of H.264; slower to encode",
  },
  prores: {
    label: "ProRes 422 HQ",
    container: "MOV",
    hint: "Large, near-lossless: for finishing in another editor",
  },
};

// Broadcast rates are fractions (29.97 is 30000/1001), so each is a numerator and denominator.
const FRAME_RATES: [number, number][] = [
  [24000, 1001],
  [24, 1],
  [25, 1],
  [30000, 1001],
  [30, 1],
  [50, 1],
  [60000, 1001],
  [60, 1],
];

const fpsText = ([num, den]: [number, number]) => `${Math.round((num / den) * 1000) / 1000} fps`;

/** Video is encoded in even sizes, and nothing useful is smaller than a thumbnail or bigger than 8K. */
export const clampSize = (v: number) =>
  Math.min(8192, Math.max(16, Math.round((Number.isFinite(v) ? v : 0) / 2) * 2));

/**
 * The pictures in the export (shown by a segment, for some part that isn't cut) that would be scaled
 * up to fill a frame of this size. A small file that nothing in the output uses is not a problem.
 */
export function smallerThan(
  edit: Pick<EditList, "width" | "height">,
  media: MediaItem[],
  exported: Set<string>,
): MediaItem[] {
  const project = { fps: 0, width: edit.width, height: edit.height };
  return media.filter(
    (m) =>
      m.included &&
      exported.has(m.id) &&
      (m.kind === "video" || m.kind === "image") &&
      isLowRes(m.width, m.height, project),
  );
}

/**
 * The project's export properties: the picture size and frame rate everything is rendered and
 * exported at. They are part of the edit, so changing them is saved with it. Any size can be typed;
 * the picker offers common ones. A frame rate outside the presets (from an older project) still
 * shows, as its own entry.
 */
export function ProjectPanel({
  edit,
  media,
  exported,
  onEdit,
}: {
  edit: EditList;
  media: MediaItem[];
  /** The channels that reach the output (see `exportedChannelIds`). */
  exported: Set<string>;
  onEdit: (edit: EditList) => void;
}) {
  const rates = FRAME_RATES.some(([n, d]) => n === edit.fps_num && d === edit.fps_den)
    ? FRAME_RATES
    : [...FRAME_RATES, [edit.fps_num, edit.fps_den] as [number, number]];
  const encoding = edit.encoding || "h264";
  const preset = SIZES.find((s) => s.w === edit.width && s.h === edit.height);
  const small = smallerThan(edit, media, exported);
  const warning = small.length
    ? `${small.length === 1 ? "1 file in the export is" : `${small.length} files in the export are`} smaller than ${edit.width}×${edit.height} and will be scaled up (soft): ${small.map((m) => m.label).join(", ")}`
    : "";
  return (
    <RibbonGroup
      title={
        warning ? (
          // The warning sits in the panel's name, so the controls keep every row.
          <span
            role="status"
            aria-label={warning}
            title={warning}
            data-testid="scaled-up-warning"
            class="inline-flex items-center gap-1 text-amber-300"
          >
            <Icon icon={Warning} />
            Project · {small.length} scaled up
          </span>
        ) : (
          "Project"
        )
      }
    >
      <RibbonSet columns={4}>
        <RibbonCell columns={4}>
          <Select
            block
            aria-label="Frame rate"
            title="The frame rate everything is rendered and exported at"
            value={`${edit.fps_num}/${edit.fps_den}`}
            onChange={(e) => {
              const [fps_num, fps_den] = e.currentTarget.value.split("/").map(Number);
              onEdit({ ...edit, fps_num, fps_den });
            }}
          >
            {rates.map(([n, d]) => (
              <option key={`${n}/${d}`} value={`${n}/${d}`}>
                {fpsText([n, d])}
              </option>
            ))}
          </Select>
        </RibbonCell>
        <RibbonCell columns={4}>
          <Select
            block
            aria-label="Output format"
            title={`How the render is encoded: ${ENCODINGS[encoding]?.hint ?? ""}`}
            value={encoding}
            onChange={(e) => onEdit({ ...edit, encoding: e.currentTarget.value })}
          >
            {Object.entries(ENCODINGS).map(([id, e]) => (
              <option key={id} value={id} title={e.hint}>
                {e.label} · {e.container}
              </option>
            ))}
            {!ENCODINGS[edit.encoding] && <option value={edit.encoding}>{edit.encoding}</option>}
          </Select>
        </RibbonCell>
        <RibbonCell columns={4}>
          <Select
            block
            aria-label="Common sizes"
            title="Pick a common size (or type any size below)"
            value={preset ? `${preset.w}x${preset.h}` : "custom"}
            onChange={(e) => {
              const [width, height] = e.currentTarget.value.split("x").map(Number);
              if (width && height) onEdit({ ...edit, width, height });
            }}
          >
            {!preset && (
              <option value="custom" disabled>
                Custom
              </option>
            )}
            {SIZES.map((s) => (
              <option key={`${s.w}x${s.h}`} value={`${s.w}x${s.h}`}>
                {s.name}
              </option>
            ))}
          </Select>
        </RibbonCell>
        <RibbonNumber
          label="Width (px)"
          prefix="W"
          step={2}
          value={edit.width}
          onChange={(v) => onEdit({ ...edit, width: clampSize(v) })}
        />
        <RibbonNumber
          label="Height (px)"
          prefix="H"
          step={2}
          value={edit.height}
          onChange={(v) => onEdit({ ...edit, height: clampSize(v) })}
        />
      </RibbonSet>
    </RibbonGroup>
  );
}

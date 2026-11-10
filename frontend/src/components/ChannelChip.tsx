import type { MediaKind } from "../lib/api";
import { channelStyle } from "../lib/channelStyle";

/** A numbered button that puts a camera or still on screen, colored by what it is. */
export function ChannelChip({
  kind,
  number,
  title,
  ariaLabel,
  size = "sm",
  onClick,
}: {
  kind: Exclude<MediaKind, "audio">;
  number: number | null;
  title: string;
  ariaLabel: string;
  size?: "sm" | "md";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={`rounded ${channelStyle(kind).chip} ${size === "md" ? "min-w-7 px-2 py-1 text-sm" : "min-w-5 px-1.5"}`}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {number ?? "•"}
    </button>
  );
}

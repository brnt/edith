import type { MediaKind } from "../lib/api";
import { channelStyle } from "../lib/channelStyle";

/** A numbered button that puts a camera or still on screen, colored by what it is. */
export function ChannelChip({
  kind,
  number,
  title,
  ariaLabel,
  onClick,
}: {
  kind: Exclude<MediaKind, "audio">;
  number: number | null;
  title: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={`min-w-5 rounded px-1.5 ${channelStyle(kind).chip}`}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {number ?? "•"}
    </button>
  );
}

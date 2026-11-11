import type { MediaItem } from "../lib/api";
import { Icon } from "./Icon";
import { Warning } from "./icons";

/**
 * A warning icon for media whose source file can't be read (a drive unplugged, or it moved);
 * nothing for media that's fine. Clicking it calls `onShow` (the Media tab, where the file can
 * be relinked). A span, not a button: it often sits inside a button of its own.
 * `class` positions it (absolutely on tiles, inline in timeline rows).
 */
export function MissingFlag(props: { item: MediaItem; onShow?: () => void; class?: string }) {
  const { item } = props;
  if (!item.missing) return null;
  return (
    <span
      role="img"
      data-testid="missing-flag"
      aria-label={`${item.label} can't be read`}
      title={`Can't read ${item.path}: the file is missing (a drive unplugged, or it moved). Click to see the Media tab.`}
      class={`grid h-[18px] w-[18px] shrink-0 cursor-pointer place-items-center rounded bg-black/70 text-sm leading-none text-red-400 hover:bg-black ${props.class ?? ""}`}
      onClick={(e) => {
        e.stopPropagation(); // not a click on whatever holds it (a tile would cut to it)
        props.onShow?.();
      }}
    >
      <Icon icon={Warning} />
    </span>
  );
}

import { Icon } from "./Icon";
import { CheckCircle, ExclamationCircle } from "./icons";

/**
 * The Sync tab's state as an icon like the rest of the interface: a green check when every file is
 * placed, an amber exclamation when some are not. The words stay for screen readers and the tooltip.
 */
export function SyncStatus({ complete }: { complete: boolean }) {
  return (
    <span
      class={`inline-flex items-center text-base leading-none ${complete ? "text-emerald-400" : "text-amber-400"}`}
      title={complete ? "Every file is synced" : "Some files are not synced yet (or need a look)"}
    >
      <Icon icon={complete ? CheckCircle : ExclamationCircle} />
      <span class="sr-only">{complete ? "synced" : "incomplete"}</span>
    </span>
  );
}

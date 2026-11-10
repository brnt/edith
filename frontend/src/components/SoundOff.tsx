import { Icon } from "./Icon";
import { Sound, Stop } from "./icons";

/**
 * "No sound": a speaker with a crossed circle over it. Ant's own muted-audio icon only reads as
 * muted next to its sound-wave twin, so this one says it on its own.
 */
export function SoundOff({ class: cls }: { class?: string }) {
  return (
    <span aria-hidden="true" class={`relative inline-flex leading-none ${cls ?? ""}`}>
      <Icon icon={Sound} />
      <Icon icon={Stop} class="absolute inset-0 text-red-400" />
    </span>
  );
}

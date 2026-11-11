import type { ComponentChildren, JSX } from "preact";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";

import { Icon } from "./Icon";
import { NEUTRAL_BUTTON } from "./ui";

/**
 * The ribbon's layout grid. One unit is a 33px square with 3px between cells, so a group's content
 * is at most RIBBON_ROWS units tall. Buttons come in two sizes: 1×1 (icon only) and 2×2 (icon plus one
 * short word: two units plus the gap between them, so it is as big as a 2×2 block of small ones);
 * drop-downs are whole units wide, one unit tall, and the same width within a set.
 * Every control has a name (`label`) that is its tooltip and aria-label, hotkey included.
 */
export const RIBBON_ROWS = 4;
const UNIT = "2.0625rem";

/** Where a control sits in its group's grid (1-based), and how many units it spans. */
interface Cell {
  row: number;
  col: number;
  cols?: number;
  rows?: number;
}

const place = ({ row, col, cols = 1, rows = 1 }: Cell): JSX.CSSProperties => ({
  gridRow: `${row} / span ${rows}`,
  gridColumn: `${col} / span ${cols}`,
});

/** The frame every ribbon group shares: a rule on its right edge and its name underneath. */
export function GroupFrame({
  title,
  width,
  children,
}: {
  title: string;
  width?: string;
  children: ComponentChildren;
}) {
  return (
    <div
      class={`flex h-full shrink-0 flex-col justify-between border-r border-neutral-700 pr-3 text-sm ${width ?? ""}`}
    >
      {children}
      <div
        class="truncate pt-1 text-center text-[10px] uppercase tracking-wide text-neutral-500"
        title={title}
      >
        {title}
      </div>
    </div>
  );
}

/** A ribbon group laid out on the unit grid: `columns` units wide, RIBBON_ROWS tall. */
export function RibbonGroup({
  title,
  columns,
  children,
}: {
  title: string;
  columns: number;
  children: ComponentChildren;
}) {
  return (
    <GroupFrame title={title}>
      <div
        class="grid content-start gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${columns}, ${UNIT})`,
          gridTemplateRows: `repeat(${RIBBON_ROWS}, ${UNIT})`,
        }}
      >
        {children}
      </div>
    </GroupFrame>
  );
}

/**
 * A ribbon button: 1×1 is the icon alone; 2×2 adds one short word (`text`) under the icon.
 * `label` is the name (tooltip and aria-label); `hotkey` is appended to both when there is one.
 */
export function RibbonButton({
  label,
  hotkey,
  text,
  icon,
  glyph,
  size = 1,
  at,
  disabled,
  onClick,
}: {
  label: string;
  hotkey?: string;
  /** The one word shown on a 2×2 button. */
  text?: string;
  icon?: IconDefinition;
  /** A character to draw instead of an icon, where no icon says it (e.g. "[" for an in point). */
  glyph?: string;
  size?: 1 | 2;
  at: { row: number; col: number };
  disabled?: boolean;
  onClick: () => void;
}) {
  const name = hotkey ? `${label} (${hotkey})` : label;
  const big = size === 2;
  const span = big ? 2 : 1;
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      disabled={disabled}
      style={place({ ...at, cols: span, rows: span })}
      class={`flex flex-col items-center justify-center rounded-[5px] p-0 disabled:cursor-not-allowed ${NEUTRAL_BUTTON} ${big ? "gap-1 text-[1.75rem]" : "text-xl"}`}
      onClick={onClick}
    >
      {icon && <Icon icon={icon} />}
      {glyph && <span class="font-mono leading-none">{glyph}</span>}
      {big && text && <span class="text-[11px] leading-none">{text}</span>}
    </button>
  );
}

/** Any other control (a drop-down, a readout) placed on the grid; it fills its cell. */
export function RibbonCell({ at, children }: { at: Cell; children: ComponentChildren }) {
  return (
    <div class="min-w-0" style={place(at)}>
      {children}
    </div>
  );
}

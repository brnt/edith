import type { ComponentChildren } from "preact";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";

import { Icon } from "./Icon";
import { NEUTRAL_BUTTON } from "./ui";

/**
 * The ribbon's layout grid. One unit is a 33px square with 3px between cells. A panel (`RibbonGroup`)
 * is one or more button groups (`RibbonSet`) stacked top to bottom, at most RIBBON_ROWS units tall in all;
 * a hairline in the 3px gap marks the break between sets. Within a set, controls flow left to right and
 * wrap in written order, so a set is just "an integer number of units wide". Large buttons (2×2: icon plus
 * one short word) occupy a 2×2 block; small buttons (icon only) occupy 1×1 but draw 29px square, centred in
 * the cell; drop-downs span whole units, one unit tall, the same width within a set.
 * Every control has a name (`label`) that is its tooltip and aria-label, hotkey included.
 */
export const RIBBON_ROWS = 4;
const UNIT = "2.0625rem";
/** A small button's face. A unit includes implicit padding: the 1×1 cell is 33px, the face 29px. */
const SMALL = "1.8125rem";

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

/** A ribbon panel: button groups (`RibbonSet`) stacked, with a hairline in the gap between them. */
export function RibbonGroup({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <GroupFrame title={title}>
      <div class="flex flex-col gap-[3px] [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:-top-[2px] [&>*+*]:before:h-px [&>*+*]:before:w-full [&>*+*]:before:bg-neutral-700">
        {children}
      </div>
    </GroupFrame>
  );
}

/** A button group: `columns` units wide, as many units tall as its controls need. */
export function RibbonSet({ columns, children }: { columns: number; children: ComponentChildren }) {
  return (
    <div
      class="grid gap-[3px]"
      style={{
        gridTemplateColumns: `repeat(${columns}, ${UNIT})`,
        gridAutoRows: UNIT,
        gridAutoFlow: "row dense",
      }}
    >
      {children}
    </div>
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
  custom,
  size = 1,
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
  /** Any other drawn icon (a composed one such as SoundOff). */
  custom?: ComponentChildren;
  size?: 1 | 2;
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
      style={
        big
          ? { gridArea: `span ${span} / span ${span}` }
          : { width: SMALL, height: SMALL, placeSelf: "center" }
      }
      class={`flex flex-col items-center justify-center rounded-[5px] p-0 disabled:cursor-not-allowed ${NEUTRAL_BUTTON} ${big ? "gap-1 text-[1.75rem]" : "text-xl"}`}
      onClick={onClick}
    >
      {icon && <Icon icon={icon} />}
      {custom}
      {glyph && <span class="font-mono leading-none">{glyph}</span>}
      {big && text && <span class="text-[11px] leading-none">{text}</span>}
    </button>
  );
}

/** Any other control (a drop-down, a readout) in the flow: `columns` units wide, one unit tall. */
export function RibbonCell({
  columns = 1,
  children,
}: {
  columns?: number;
  children: ComponentChildren;
}) {
  return (
    <div class="min-w-0" style={{ gridColumn: `span ${columns}` }}>
      {children}
    </div>
  );
}

/**
 * A number field on the grid: sunken (so it reads as typeable), one unit tall, `columns` units wide, with
 * its prefix and unit inside the field. `label` is its name (tooltip + aria-label).
 */
export function RibbonNumber({
  label,
  prefix,
  unit,
  value,
  step,
  columns = 2,
  onChange,
}: {
  label: string;
  prefix?: string;
  unit?: string;
  value: number;
  step: number;
  columns?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label
      title={label}
      class="flex min-w-0 items-center gap-[3px] rounded-[5px] bg-[#1c1c1c] px-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_#3a3a3a]"
      style={{ gridColumn: `span ${columns}` }}
    >
      {prefix && <span class="text-neutral-400">{prefix}</span>}
      <input
        type="number"
        step={step}
        aria-label={label}
        class="min-w-0 flex-1 bg-transparent text-right [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      {unit && <span class="text-neutral-400">{unit}</span>}
    </label>
  );
}

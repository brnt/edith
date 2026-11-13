import type { ComponentChildren } from "preact";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";

import { Icon } from "./Icon";
import { NEUTRAL_BUTTON, neutralLink, SMALL } from "./ui";

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
const LARGE = `calc(${UNIT} * 2 - 1px)`;

/** The frame every ribbon group shares: a rule on its right edge and its name underneath. */
export function GroupFrame({
  title,
  width,
  children,
}: {
  title: ComponentChildren;
  width?: string;
  children: ComponentChildren;
}) {
  return (
    <div
      class={`flex h-full shrink-0 flex-col justify-between border-r border-neutral-700 pr-3 text-sm last:border-r-0 last:pr-0 ${width ?? ""}`}
    >
      {children}
      <div
        class="truncate pt-1 text-center text-[10px] uppercase tracking-wide text-neutral-500"
        title={typeof title === "string" ? title : undefined}
      >
        {title}
      </div>
    </div>
  );
}

/** A ribbon panel: button groups (`RibbonSet`) stacked, with a hairline in the gap between them. */
export function RibbonGroup({
  title,
  grow = false,
  width,
  children,
}: {
  title: ComponentChildren;
  /** Take all the width the other panels leave (its contents scroll inside it). */
  grow?: boolean;
  /** A fixed width, as a class (the panel's contents scroll inside it). */
  width?: string;
  children: ComponentChildren;
}) {
  return (
    <GroupFrame title={title} width={grow ? "min-w-0 flex-1" : width}>
      <div class="flex min-w-0 flex-col gap-[3px] [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:-top-[2px] [&>*+*]:before:h-px [&>*+*]:before:w-full [&>*+*]:before:bg-neutral-700">
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
  custom,
  size = 1,
  disabled,
  onClick,
  href,
  download,
}: {
  label: string;
  hotkey?: string;
  /** The one word shown on a 2×2 button. */
  text?: string;
  icon?: IconDefinition;
  /** Any other drawn icon (a composed one). */
  custom?: ComponentChildren;
  size?: 1 | 2;
  disabled?: boolean;
  onClick?: () => void;
  /** A download link instead of an action: the same face, off (and without a link) when disabled. */
  href?: string;
  download?: boolean | string;
}) {
  const name = hotkey ? `${label} (${hotkey})` : label;
  const big = size === 2;
  const span = big ? 2 : 1;
  const face = `flex flex-col items-center justify-center rounded-[5px] p-0 ${big ? "gap-1 text-[1.75rem]" : "text-xl"}`;
  // Both sizes keep the unit's 4 px of implicit padding: a small face is 29 px in its 33 px cell, a
  // large one 65 px in its 69 px (2 cells and the gap between them).
  const place = big
    ? { gridArea: `span ${span} / span ${span}`, width: LARGE, height: LARGE, placeSelf: "center" }
    : { width: SMALL, height: SMALL, placeSelf: "center" };
  if (href !== undefined) {
    return (
      <a
        href={disabled ? undefined : href}
        download={download}
        title={name}
        aria-label={name}
        aria-disabled={disabled || undefined}
        style={place}
        class={`${face} ${neutralLink(!disabled)}`}
      >
        {icon && <Icon icon={icon} />}
        {custom}
        {big && text && <span class="text-[11px] leading-none">{text}</span>}
      </a>
    );
  }
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      disabled={disabled}
      style={place}
      class={`${face} disabled:cursor-not-allowed ${NEUTRAL_BUTTON}`}
      onClick={onClick}
    >
      {icon && <Icon icon={icon} />}
      {custom}
      {big && text && <span class="text-[11px] leading-none">{text}</span>}
    </button>
  );
}

/*
 * Every control in a ribbon grid keeps the unit's 4 px of implicit padding (2 px a side), so its
 * visible face is its cells minus 4 px: a small button 29 px, a large one 65, a drop-down 29 tall, a
 * number field or slider 29 tall (`m-[2px]`).
 */

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

// A button joined to a neighbour (the slider's action, a stack's buttons): raised like any
// button, square where it meets the neighbour, and a disabled edge with no seam on that side.
const JOINED_BUTTON =
  "flex items-center justify-center bg-[#505050] p-0 text-xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-[#5c5c5c] disabled:cursor-not-allowed disabled:bg-[#2c2c2c] disabled:text-[#686868] disabled:shadow-[inset_0_1px_0_#4a4a4a,inset_0_-1px_0_#4a4a4a,inset_-1px_0_0_#4a4a4a] disabled:hover:bg-[#2c2c2c]";

/**
 * Buttons stacked in a column on the grid's `column`, from `row`, joined to each other (no gaps,
 * rounded only on the outer right) and to whatever sits on their left (a waveform): the left side
 * is square and reaches 5 px back to meet it. One unit wide less the 2 px inset, one unit tall each.
 */
export function RibbonButtonStack({
  column,
  row,
  actions,
}: {
  column: number;
  row: number;
  actions: { icon: IconDefinition; label: string; disabled?: boolean; onClick: () => void }[];
}) {
  return (
    <div
      class="my-[2px] flex flex-col self-stretch justify-self-end"
      style={{
        gridColumn: column,
        gridRow: `${row} / span ${actions.length}`,
        width: SMALL,
        marginRight: 2,
      }}
    >
      {actions.map((a, i) => (
        <button
          key={a.label}
          type="button"
          title={a.label}
          aria-label={a.label}
          disabled={a.disabled}
          class={`${JOINED_BUTTON} flex-1 ${i === 0 ? "rounded-tr-[5px]" : ""} ${i === actions.length - 1 ? "rounded-br-[5px]" : ""}`}
          onClick={a.onClick}
        >
          <Icon icon={a.icon} />
        </button>
      ))}
    </div>
  );
}

/**
 * A slider on the grid: sunken like the number field, one unit tall, `columns` units wide, with its
 * readout (`display`) inside. `onInput` follows the drag; `onCommit` fires once on release.
 *
 * With an `action`, it is a slider+button combo: the button is joined to the slider's right end (one
 * control, no gap, square corners and no border where the two meet), and `columns` counts both. Use it for a
 * value with one companion action, such as a level and its mute.
 */
export function RibbonSlider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  columns = 3,
  disabled,
  action,
  onInput,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  columns?: number;
  disabled?: boolean;
  /** The joined button on the right: its icon, name (tooltip + aria-label) and what it does. */
  action?: { icon: IconDefinition; label: string; disabled?: boolean; onClick: () => void };
  onInput: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const field = (
    <label
      title={label}
      class={`flex min-w-0 flex-1 items-center gap-1.5 bg-[#1c1c1c] px-1.5 text-[12px] ${
        action
          ? // Framed in the button's own colours (its face, its top highlight, its disabled edge), so the
            // two read as one object.
            `rounded-l-[5px] ${disabled || action.disabled ? "shadow-[inset_1px_0_0_#4a4a4a,inset_0_1px_0_#4a4a4a,inset_0_-1px_0_#4a4a4a]" : "shadow-[inset_1px_0_0_#505050,inset_0_1px_0_#686868,inset_0_-1px_0_#505050]"}`
          : "rounded-[5px] shadow-[inset_0_0_0_1px_#505050]"
      } ${disabled ? "text-neutral-600" : "text-neutral-300"}`}
    >
      <input
        type="range"
        aria-label={label}
        class="slider min-w-0 flex-1 disabled:cursor-not-allowed"
        style={{ "--zero": (0 - min) / (max - min) }}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onInput={(e) => onInput(Number(e.currentTarget.value))}
        onChange={(e) => onCommit(Number(e.currentTarget.value))}
      />
      {/* A fixed width (digits all the same width), so the track does not jump as the value changes. */}
      <span class="w-10 shrink-0 whitespace-nowrap text-right tabular-nums">{display}</span>
    </label>
  );
  return (
    <div class="m-[2px] flex min-w-0" style={{ gridColumn: `span ${columns}` }}>
      {field}
      {action && (
        <button
          type="button"
          title={action.label}
          aria-label={action.label}
          disabled={action.disabled}
          class={`${JOINED_BUTTON} shrink-0 rounded-r-[5px]`}
          style={{ width: SMALL }}
          onClick={action.onClick}
        >
          <Icon icon={action.icon} />
        </button>
      )}
    </div>
  );
}

/**
 * Progress on the grid: a sunken one-unit-tall bar, `columns` units wide, filling in the buttons' own
 * grey with the percentage over it. `label` (what is happening) is its tooltip and accessible name.
 */
export function RibbonProgress({
  value,
  label,
  columns = 2,
}: {
  value: number;
  label: string;
  columns?: number;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      title={label}
      class="relative m-[2px] min-w-0 overflow-hidden rounded-[5px] bg-[#1c1c1c] shadow-[inset_0_0_0_1px_#505050]"
      style={{ gridColumn: `span ${columns}` }}
    >
      <div class="absolute inset-y-0 left-0 bg-[#505050]" style={{ width: `${percent}%` }} />
      <span class="relative grid h-full place-items-center text-[12px] tabular-nums text-neutral-200">
        {percent}%
      </span>
    </div>
  );
}

/** A text field on the grid: sunken like the number field, one unit tall, `columns` units wide. */
export function RibbonText({
  label,
  value,
  placeholder,
  maxLength,
  columns = 4,
  onInput,
  onBlur,
  onKeyDown,
}: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  columns?: number;
  onInput: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <label
      title={label}
      class="m-[2px] flex min-w-0 items-center rounded-[5px] bg-[#1c1c1c] px-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_#505050]"
      style={{ gridColumn: `span ${columns}` }}
    >
      <input
        type="text"
        aria-label={label}
        class="min-w-0 flex-1 bg-transparent focus:outline-none"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onInput={(e) => onInput(e.currentTarget.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    </label>
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
      class="m-[2px] flex min-w-0 items-center gap-[3px] rounded-[5px] bg-[#1c1c1c] px-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_#505050]"
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

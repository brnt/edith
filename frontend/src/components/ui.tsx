import type { ComponentChildren, JSX } from "preact";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";
import { useEffect, useRef, useState } from "preact/hooks";

import { Icon } from "./Icon";
import { Down } from "./icons";

type ButtonProps = JSX.IntrinsicElements["button"] & {
  variant?: "default" | "primary" | "danger" | "ghost";
  /** An icon shown before the label; the label stays the accessible name. */
  icon?: IconDefinition;
  /** `sm` is for dense toolbars (the Edit tab). */
  size?: "sm" | "md";
};

/**
 * The neutral button: a raised, lighter fill when enabled (top highlight); sunken, darker than the
 * ribbon, with a dim icon and a hairline when disabled. The hairline is an inset shadow so the
 * button's size doesn't change.
 */
export const NEUTRAL_BUTTON =
  "bg-[#505050] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-[#5c5c5c] disabled:bg-[#2c2c2c] disabled:text-[#686868] disabled:shadow-[inset_0_0_0_1px_#4a4a4a] disabled:hover:bg-[#2c2c2c]";
/** The same look for a link that is styled as a button and can be off. */
export const neutralLink = (on: boolean) =>
  on
    ? "bg-[#505050] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-[#5c5c5c]"
    : "pointer-events-none bg-[#2c2c2c] text-[#686868] shadow-[inset_0_0_0_1px_#4a4a4a]";

/** Any button that is off is grey, whatever it is when on: a blue or red one must not look live. */
const DISABLED_GREY =
  "disabled:bg-[#2c2c2c] disabled:text-[#686868] disabled:shadow-[inset_0_0_0_1px_#4a4a4a] disabled:hover:bg-[#2c2c2c]";

const VARIANTS = {
  default: NEUTRAL_BUTTON,
  primary: `bg-sky-600 hover:bg-sky-500 text-white ${DISABLED_GREY}`,
  danger: `bg-red-700 hover:bg-red-600 text-white ${DISABLED_GREY}`,
  ghost: "bg-transparent hover:bg-neutral-800 text-neutral-300",
};

export function Button({
  variant = "default",
  icon,
  size = "md",
  class: cls,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      class={`inline-flex items-center rounded disabled:cursor-not-allowed ${variant === "ghost" ? "disabled:opacity-70" : ""} ${size === "sm" ? "gap-1 px-2 py-0.5 text-[13px]" : "gap-1.5 px-3 py-1 text-sm"} ${VARIANTS[variant]} ${cls ?? ""}`}
    >
      {icon && <Icon icon={icon} />}
      {children}
    </button>
  );
}

/**
 * Buttons that belong together (undo/redo): a hairline apart. Separate groups, and
 * loose buttons, sit a full gap apart (`gap-3`) in whatever holds them.
 */
export function ButtonGroup({ children }: { children: ComponentChildren }) {
  return (
    <div role="group" class="flex items-center gap-0.5">
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  icon?: IconDefinition;
  children: ComponentChildren;
}) {
  const tones = {
    neutral: "bg-neutral-700 text-neutral-200",
    good: "bg-emerald-900 text-emerald-200",
    warn: "bg-amber-900 text-amber-200",
    bad: "bg-red-900 text-red-200",
  };
  return (
    <span class={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${tones[tone]}`}>
      {icon && <Icon icon={icon} />}
      {children}
    </span>
  );
}

/**
 * The visible size of a small button (and the height of a drop-down): 29 px. A ribbon unit is 33 px,
 * so the face sits centred in it, the unit's other 4 px being its implicit padding.
 */
export const SMALL = "1.8125rem";

/**
 * The face every drop-down shares (the menu button and the native select): as tall as a small
 * button, raised neutral, 5px corners, 13px text, label left and caret right.
 */
const DROP_FACE = `h-[1.8125rem] rounded-[5px] pl-2 text-[13px] ${NEUTRAL_BUTTON}`;

/** In the ribbon's grid a drop-down fills its cell but, like a small button, keeps the unit's padding. */
const CELL = "flex h-full w-full items-center px-[2px]";

/**
 * A native drop-down styled like `Dropdown`: raised neutral, label left, caret right. `block` fills
 * the cell it sits in (the ribbon's grid). Use it for every select in a panel.
 */
export function Select({
  block = false,
  class: cls,
  children,
  ...props
}: { block?: boolean; class?: string } & Omit<
  JSX.SelectHTMLAttributes<HTMLSelectElement>,
  "class"
>) {
  return (
    <span class={`relative ${block ? CELL : "inline-flex"}`}>
      <select
        {...props}
        class={`peer w-full cursor-pointer appearance-none truncate py-0 pr-6 ${DROP_FACE} [&>option]:bg-neutral-900 ${cls ?? ""}`}
      >
        {children}
      </select>
      <Icon
        icon={Down}
        class={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs peer-disabled:text-[#686868] ${block ? "right-[10px]" : "right-2"}`}
      />
    </span>
  );
}

/** A button that opens a menu over the page. Fixed-positioned, so no ancestor can clip it. */
export function Dropdown({
  label,
  block = false,
  children,
}: {
  label: ComponentChildren;
  /** Fill the width and height of the cell it sits in (the ribbon's grid), label left, caret right. */
  block?: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = () => {
    const rect = box.current?.getBoundingClientRect();
    // 296 = the menu's width plus a margin, so it never runs off the right edge.
    if (rect)
      setAt({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)),
        top: rect.bottom + 4,
      });
    setOpen((v) => !v);
  };

  return (
    <div ref={box} class={`relative ${block ? CELL : "inline-block"}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        class={`flex cursor-pointer items-center justify-between gap-1.5 py-0 pr-2 disabled:cursor-not-allowed ${DROP_FACE} ${block ? "w-full" : ""}`}
      >
        <span class="truncate">{label}</span>
        <Icon icon={Down} class="shrink-0 text-xs" />
      </button>
      {open && (
        <div
          class="fixed z-50 max-h-72 w-72 overflow-y-auto rounded border border-neutral-600 bg-neutral-900 p-2 text-sm shadow-xl"
          style={{ left: at.left, top: at.top }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div class="text-xs text-neutral-400">
      <div class="h-1.5 w-48 overflow-hidden rounded bg-neutral-800">
        <div class="h-full bg-sky-500" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      {label}
    </div>
  );
}

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

const VARIANTS = {
  default: "bg-neutral-700 hover:bg-neutral-600 text-neutral-100",
  primary: "bg-sky-600 hover:bg-sky-500 text-white",
  danger: "bg-red-700 hover:bg-red-600 text-white",
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
      class={`inline-flex items-center rounded disabled:opacity-70 disabled:cursor-not-allowed ${size === "sm" ? "gap-1 px-2 py-0.5 text-[13px]" : "gap-1.5 px-3 py-1 text-sm"} ${VARIANTS[variant]} ${cls ?? ""}`}
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

/** A button that opens a menu over the page. Fixed-positioned, so no ancestor can clip it. */
export function Dropdown({
  label,
  children,
}: {
  label: ComponentChildren;
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
    <div ref={box} class="relative">
      <Button onClick={toggle} aria-expanded={open}>
        {label}
        <Icon icon={Down} class="text-xs" />
      </Button>
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

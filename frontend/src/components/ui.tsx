import type { ComponentChildren, JSX } from "preact";

type ButtonProps = JSX.IntrinsicElements["button"] & {
  variant?: "default" | "primary" | "danger" | "ghost";
};

const VARIANTS = {
  default: "bg-neutral-700 hover:bg-neutral-600 text-neutral-100",
  primary: "bg-sky-600 hover:bg-sky-500 text-white",
  danger: "bg-red-700 hover:bg-red-600 text-white",
  ghost: "bg-transparent hover:bg-neutral-800 text-neutral-300",
};

export function Button({ variant = "default", class: cls, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      class={`rounded px-3 py-1 text-sm disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${cls ?? ""}`}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  children: ComponentChildren;
}) {
  const tones = {
    neutral: "bg-neutral-700 text-neutral-200",
    good: "bg-emerald-900 text-emerald-200",
    warn: "bg-amber-900 text-amber-200",
    bad: "bg-red-900 text-red-200",
  };
  return <span class={`rounded px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

export function Section({
  title,
  right,
  children,
  open = true,
}: {
  title: string;
  right?: ComponentChildren;
  children: ComponentChildren;
  open?: boolean;
}) {
  return (
    <details open={open} class="rounded border border-neutral-800 bg-neutral-900">
      <summary class="flex cursor-pointer items-center justify-between px-4 py-2 text-sm font-semibold">
        <span>{title}</span>
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </summary>
      <div class="border-t border-neutral-800 p-4">{children}</div>
    </details>
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

import type { ComponentChildren } from "preact";

export interface RibbonTab {
  id: string;
  label: string;
  badge?: ComponentChildren;
}

/**
 * A tab bar over a content area of fixed height. The selected tab and the panel share one
 * background so the tab reads as the folder tab of the panel it opens.
 */
export const RIBBON_HEIGHT = "11.75rem";
const TABS_HEIGHT = "2rem";

export function Ribbon({
  tabs,
  active,
  onSelect,
  children,
}: {
  tabs: RibbonTab[];
  active: string;
  onSelect: (id: string) => void;
  children: ComponentChildren;
}) {
  return (
    <section
      data-testid="ribbon"
      class="flex shrink-0 flex-col border-y border-neutral-800 bg-neutral-900"
      style={{ height: RIBBON_HEIGHT }}
    >
      <div
        role="tablist"
        class="flex shrink-0 items-end gap-1 px-3"
        style={{ height: TABS_HEIGHT }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={tab.id === active}
            class={`flex items-center gap-2 rounded-t px-4 py-1 text-sm ${
              tab.id === active
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:bg-neutral-800/60"
            }`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {tab.badge}
          </button>
        ))}
      </div>
      <div role="tabpanel" class="min-h-0 flex-1 overflow-auto bg-neutral-800 p-3">
        {children}
      </div>
    </section>
  );
}

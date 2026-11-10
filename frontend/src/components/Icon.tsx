import { h, type ComponentChild } from "preact";
import type { AbstractNode, IconDefinition } from "@ant-design/icons-svg/es/types";

function render(node: AbstractNode, key?: number): ComponentChild {
  return h(
    node.tag,
    { ...node.attrs, key },
    node.children?.map((child, i) => render(child, i)),
  );
}

/**
 * An Ant Design icon, drawn from the framework-free icon data (@ant-design/icons-svg).
 * It takes its color and size from the surrounding text, and is hidden from screen readers:
 * a control always carries its own visible text or aria-label.
 */
export function Icon({ icon, class: cls }: { icon: IconDefinition; class?: string }) {
  const node =
    typeof icon.icon === "function" ? icon.icon("currentColor", "currentColor") : icon.icon;
  return (
    <span
      aria-hidden="true"
      class={`inline-flex shrink-0 items-center ${cls ?? ""}`}
      data-icon={icon.name}
    >
      {h(
        "svg",
        { ...node.attrs, width: "1em", height: "1em", fill: "currentColor" },
        node.children?.map((child, i) => render(child, i)),
      )}
    </span>
  );
}

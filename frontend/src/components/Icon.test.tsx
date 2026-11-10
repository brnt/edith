import { render, screen } from "@testing-library/preact";
import { expect, test } from "vitest";

import { Icon } from "./Icon";
import { Plus, Scissor } from "./icons";
import { Badge, Button } from "./ui";

test("renders the Ant Design icon as an inline svg that follows the text color and size", () => {
  const { container } = render(<Icon icon={Plus} />);
  const wrapper = container.firstElementChild as HTMLElement;
  const svg = wrapper.querySelector("svg") as SVGElement;
  expect(wrapper).toHaveAttribute("aria-hidden", "true"); // decorative: the label carries the meaning
  expect(wrapper).toHaveAttribute("data-icon", "plus");
  expect(svg.getAttribute("viewBox")).toBe("64 64 896 896"); // Ant Design's own geometry
  expect(svg.getAttribute("fill")).toBe("currentColor");
  expect(svg.getAttribute("width")).toBe("1em");
  expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
});

test("different icons draw different shapes", () => {
  const { container: a } = render(<Icon icon={Plus} />);
  const { container: b } = render(<Icon icon={Scissor} />);
  expect(a.querySelector("path")?.getAttribute("d")).not.toBe(
    b.querySelector("path")?.getAttribute("d"),
  );
});

test("a button with an icon keeps its text as its name", () => {
  render(<Button icon={Scissor}>Cut (x)</Button>);
  const button = screen.getByRole("button", { name: "Cut (x)" });
  expect(button.querySelector("svg")).not.toBeNull();
});

test("a badge can carry an icon too", () => {
  const { container } = render(<Badge icon={Plus}>synced</Badge>);
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container).toHaveTextContent("synced");
});

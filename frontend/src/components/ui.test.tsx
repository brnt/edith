import { render, screen } from "@testing-library/preact";
import { expect, test } from "vitest";

import { Button } from "./ui";

test("a disabled blue or red button turns grey, like a neutral one, and does not just fade", () => {
  for (const variant of ["primary", "danger", "default"] as const) {
    render(
      <Button variant={variant} disabled>
        {variant}
      </Button>,
    );
    const button = screen.getByRole("button", { name: variant });
    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:bg-[#2c2c2c]");
    expect(button.className).toContain("disabled:text-[#686868]");
    expect(button.className).not.toContain("disabled:opacity");
  }
});

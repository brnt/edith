import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import { AUDIO_WAVEFORM, CHANNEL_STYLE } from "../lib/channelStyle";
import { ChannelChip } from "./ChannelChip";

// Colors that read as a warning, or are already taken (red = cuts, amber = playhead).
const RESERVED = /red|amber|orange|rose|pink|fuchsia|purple|violet/;

test("cameras are blue and stills are teal, in one family of calm colors", () => {
  expect(CHANNEL_STYLE.video.chip).toContain("sky");
  expect(CHANNEL_STYLE.image.chip).toContain("teal");
  for (const style of Object.values(CHANNEL_STYLE)) {
    expect(style.chip).not.toMatch(RESERVED);
    expect(style.span).not.toMatch(RESERVED);
  }
});

test("a chip shows its number, takes its color from what it is, and switches on click", () => {
  const onClick = vi.fn();
  const { rerender } = render(
    <ChannelChip
      kind="video"
      number={2}
      title="Cam B"
      ariaLabel="Switch to camera 2"
      onClick={onClick}
    />,
  );
  const chip = screen.getByRole("button", { name: "Switch to camera 2" });
  expect(chip).toHaveTextContent("2");
  expect(chip.className).toContain("bg-sky");
  fireEvent.click(chip);
  expect(onClick).toHaveBeenCalledTimes(1);

  rerender(
    <ChannelChip
      kind="image"
      number={null}
      title="car"
      ariaLabel="Switch to car"
      onClick={onClick}
    />,
  );
  const still = screen.getByRole("button", { name: "Switch to car" });
  expect(still).toHaveTextContent("•"); // unnumbered channels (beyond nine) get a dot
  expect(still.className).toContain("bg-teal");
});

test("the audio waveform is neutral, so it cannot be mistaken for the teal stills or blue cameras", () => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(AUDIO_WAVEFORM.slice(i, i + 2), 16));
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(40); // barely any hue
  expect(Math.min(r, g, b)).toBeGreaterThan(150); // and light enough to read on the dark timeline
});

import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import type { EditList, MediaItem } from "../lib/api";
import { Timeline } from "./Timeline";

const media: MediaItem[] = [
  {
    id: "cam",
    path: "c.mp4",
    kind: "video",
    label: "Cam",
    duration_s: 100,
    width: 1,
    height: 1,
    fps: 30,
    has_audio: true,
    proxy_ready: true,
  },
  {
    id: "mic",
    path: "m.wav",
    kind: "audio",
    label: "mic",
    duration_s: 100,
    width: null,
    height: null,
    fps: null,
    has_audio: true,
    proxy_ready: true,
  },
];

const edit: EditList = {
  switches: [],
  cuts: [{ start_s: 10, end_s: 20 }],
  tracks: [],
  mix: [],
  disabled: [],
  range_in_s: null,
  range_out_s: null,
  fps_num: 30000,
  fps_den: 1001,
  width: 1920,
  height: 1080,
};

function setup() {
  const handlers = {
    onSeek: vi.fn(),
    onSelect: vi.fn(),
    onCamera: vi.fn(),
    onTrack: vi.fn(),
    onCutChange: vi.fn(),
  };
  render(
    <Timeline
      media={media}
      offsets={{ cam: 0, mic: 0 }}
      edit={edit}
      peaks={{}}
      playhead={0}
      end={100}
      pxPerSec={10}
      selection={null}
      suggestions={[]}
      {...handlers}
    />,
  );
  return handlers;
}

// In jsdom the lanes start at x = 0, so a pointer at clientX is at clientX / 10 seconds.
const drag = (el: HTMLElement, from: number, ...to: number[]) => {
  fireEvent.pointerDown(el, { clientX: from, pointerId: 1 });
  for (const x of to) fireEvent.pointerMove(el, { clientX: x, pointerId: 1 });
};

test("dragging a cut's start edge moves it, committing once on release", () => {
  const h = setup();
  const handle = screen.getByRole("separator", { name: "Drag the start of the cut" });
  drag(handle, 100, 80, 60);
  expect(h.onCutChange).not.toHaveBeenCalled(); // live preview only until release
  expect(screen.getByText("0:06.00")).toBeInTheDocument(); // the time readout while dragging
  fireEvent.pointerUp(handle, { clientX: 60, pointerId: 1 });
  expect(h.onCutChange).toHaveBeenCalledTimes(1);
  expect(h.onCutChange).toHaveBeenCalledWith(0, 6, 20);
});

test("dragging the end edge moves only the end", () => {
  const h = setup();
  const handle = screen.getByRole("separator", { name: "Drag the end of the cut" });
  drag(handle, 200, 250);
  fireEvent.pointerUp(handle, { clientX: 250, pointerId: 1 });
  expect(h.onCutChange).toHaveBeenCalledWith(0, 10, 25);
});

test("an edge cannot be dragged past the other edge, and stays on the timeline", () => {
  const h = setup();
  const start = screen.getByRole("separator", { name: "Drag the start of the cut" });
  drag(start, 100, 300); // far beyond the end edge at 20 s
  fireEvent.pointerUp(start, { clientX: 300, pointerId: 1 });
  expect(h.onCutChange).toHaveBeenLastCalledWith(0, 19.9, 20); // keeps a 0.1 s sliver

  const end = screen.getByRole("separator", { name: "Drag the end of the cut" });
  drag(end, 200, -50);
  fireEvent.pointerUp(end, { clientX: -50, pointerId: 1 });
  expect(h.onCutChange).toHaveBeenLastCalledWith(0, 10, 10.1);
});

test("grabbing an edge does not move the playhead or start a selection", () => {
  const h = setup();
  const handle = screen.getByRole("separator", { name: "Drag the start of the cut" });
  drag(handle, 100, 150);
  fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 });
  expect(h.onSeek).not.toHaveBeenCalled();
  expect(h.onSelect).not.toHaveBeenCalled();
});

test("the playhead is amber, so it never reads as one of the red cut spans", () => {
  setup();
  const playhead = screen.getByTestId("playhead");
  expect(playhead.className).toContain("bg-amber-400");
  expect(playhead.className).not.toContain("red");
});

test("a disabled camera stays on the timeline but dimmed, with an inert marker instead of a number", () => {
  const withOff = { ...edit, disabled: ["cam"] };
  render(
    <Timeline
      media={media}
      offsets={{ cam: 0, mic: 0 }}
      edit={withOff}
      peaks={{}}
      playhead={0}
      end={100}
      pxPerSec={10}
      selection={null}
      suggestions={[]}
      onSeek={vi.fn()}
      onSelect={vi.fn()}
      onCamera={vi.fn()}
      onTrack={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Switch to Cam" })).toBeNull(); // nothing to click
  const marker = screen.getByLabelText("Cam is disabled");
  expect(marker).toHaveTextContent("–");
  expect(marker.closest("div")?.className).toContain("opacity-50"); // the row is dimmed
});

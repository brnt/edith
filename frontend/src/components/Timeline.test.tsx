import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, test, vi } from "vitest";

import type { EditList, MediaItem } from "../lib/api";
import type { Picked } from "../lib/timeline";
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
    id: "cam2",
    path: "c2.mp4",
    kind: "video",
    label: "Cam 2",
    duration_s: 100,
    width: 1,
    height: 1,
    fps: 30,
    has_audio: false,
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

function setup(opts: { edit?: Partial<EditList>; picked?: Picked | null } = {}) {
  const handlers = {
    onSeek: vi.fn(),
    onSelect: vi.fn(),
    onCamera: vi.fn(),
    onTrack: vi.fn(),
    onCutChange: vi.fn(),
    onPick: vi.fn(),
    onSegmentEdge: vi.fn(),
    onScrub: vi.fn(),
    onPreview: vi.fn(),
  };
  render(
    <Timeline
      media={media}
      offsets={{ cam: 0, cam2: 0, mic: 0 }}
      edit={{ ...edit, ...opts.edit }}
      peaks={{}}
      playhead={0}
      end={100}
      pxPerSec={10}
      selection={null}
      suggestions={[]}
      picked={opts.picked ?? null}
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
  const h = setup({ picked: { kind: "cut", index: 0 } });
  const handle = screen.getByRole("separator", { name: "Drag the start of the cut" });
  drag(handle, 100, 80, 60);
  expect(h.onCutChange).not.toHaveBeenCalled(); // live preview only until release
  expect(screen.getByText("0:06.00")).toBeInTheDocument(); // the time readout while dragging
  fireEvent.pointerUp(handle, { clientX: 60, pointerId: 1 });
  expect(h.onCutChange).toHaveBeenCalledTimes(1);
  expect(h.onCutChange).toHaveBeenCalledWith(0, 6, 20);
});

test("dragging the end edge moves only the end", () => {
  const h = setup({ picked: { kind: "cut", index: 0 } });
  const handle = screen.getByRole("separator", { name: "Drag the end of the cut" });
  drag(handle, 200, 250);
  fireEvent.pointerUp(handle, { clientX: 250, pointerId: 1 });
  expect(h.onCutChange).toHaveBeenCalledWith(0, 10, 25);
});

test("an edge cannot be dragged past the other edge, and stays on the timeline", () => {
  const h = setup({ picked: { kind: "cut", index: 0 } });
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
  const h = setup({ picked: { kind: "cut", index: 0 } });
  const handle = screen.getByRole("separator", { name: "Drag the start of the cut" });
  drag(handle, 100, 150);
  fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 });
  expect(h.onSeek).not.toHaveBeenCalled();
  expect(h.onSelect).not.toHaveBeenCalled();
});

test("a cut's edges can't be dragged until the cut is selected", () => {
  setup();
  expect(screen.queryByRole("separator", { name: /of the cut/ })).toBeNull();
});

const SWITCHES = [
  { at_s: 30, media_id: "cam2" },
  { at_s: 60, media_id: "cam" },
];
const click = (target: HTMLElement, x: number) => {
  const lanes = screen.getByTestId("timeline").querySelector(".cursor-crosshair") as HTMLElement;
  fireEvent.pointerDown(target, { clientX: x, pointerId: 1 });
  fireEvent.pointerUp(lanes, { clientX: x, pointerId: 1 }); // the lanes hold pointer capture
};

test("clicking a segment selects it without moving the playhead; clicking empty timeline seeks", () => {
  const h = setup({ edit: { switches: SWITCHES } });
  // Rows: cam 0-30 and 60-100 (switch -1 and 1), cam2 30-60 (switch 0).
  const segs = screen.getAllByTestId("segment");
  expect(segs).toHaveLength(3);
  click(segs[1], 400); // cam2's segment is the second in the rows below cam's
  expect(h.onPick).toHaveBeenCalledWith({ kind: "segment", index: expect.any(Number) });
  expect(h.onSeek).not.toHaveBeenCalled();

  const lanes = screen.getByTestId("timeline").querySelector(".cursor-crosshair") as HTMLElement;
  click(lanes, 500); // not on a segment or a cut
  expect(h.onSeek).toHaveBeenCalledWith(50);
  expect(h.onPick).toHaveBeenLastCalledWith(null);
});

test("clicking a cut selects it", () => {
  const h = setup();
  click(screen.getByTestId("cut"), 150);
  expect(h.onPick).toHaveBeenCalledWith({ kind: "cut", index: 0 });
  expect(h.onSeek).not.toHaveBeenCalled();
});

test("a selected segment can be dragged at both edges; the change is committed on release", () => {
  const h = setup({ edit: { switches: SWITCHES }, picked: { kind: "segment", index: 0 } });
  const start = screen.getByRole("separator", { name: "Drag the start of the segment" });
  drag(start, 300, 350);
  expect(h.onSegmentEdge).not.toHaveBeenCalled(); // live until release
  expect(screen.getByText("0:35.00")).toBeInTheDocument();
  fireEvent.pointerUp(start, { clientX: 350, pointerId: 1 });
  expect(h.onSegmentEdge).toHaveBeenCalledWith(0, 35);

  // The right edge of the segment is the left edge of the next one (switch 1).
  const stop = screen.getByRole("separator", { name: "Drag the end of the segment" });
  drag(stop, 600, 700, 1200); // past the end: it can't leave the timeline
  fireEvent.pointerUp(stop, { clientX: 1200, pointerId: 1 });
  expect(h.onSegmentEdge).toHaveBeenLastCalledWith(1, 100);
  expect(h.onSeek).not.toHaveBeenCalled();
});

test("dragging an edge (segment or cut) moves the playhead with it", () => {
  const h = setup({ edit: { switches: SWITCHES }, picked: { kind: "segment", index: 0 } });
  const start = screen.getByRole("separator", { name: "Drag the start of the segment" });
  drag(start, 300, 350, 380);
  expect(h.onScrub).toHaveBeenNthCalledWith(1, 30); // grabbing it
  expect(h.onScrub).toHaveBeenLastCalledWith(38);
  // The preview is the edit as it would be if dropped now: the switch has moved to 38.
  expect(h.onPreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ switches: [expect.objectContaining({ at_s: 38 }), SWITCHES[1]] }),
  );
  fireEvent.pointerUp(start, { clientX: 380, pointerId: 1 });
  expect(h.onPreview).toHaveBeenLastCalledWith(null);

  const c = setup({ picked: { kind: "cut", index: 0 } });
  const end = screen.getAllByRole("separator", { name: "Drag the end of the cut" })[0];
  drag(end, 200, 260);
  // At an end edge the playhead sits on the last frame of what is being resized.
  expect(c.onScrub).toHaveBeenLastCalledWith(expect.closeTo(26 - 1001 / 30000, 5));
});

test("an unselected segment has no drag handles", () => {
  setup({ edit: { switches: SWITCHES } });
  expect(screen.queryByRole("separator", { name: /of the segment/ })).toBeNull();
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
      offsets={{ cam: 0, cam2: 0, mic: 0 }}
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
      picked={null}
      onPick={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Switch to Cam" })).toBeNull(); // nothing to click
  const marker = screen.getByLabelText("Cam is disabled");
  expect(marker).toHaveTextContent("–");
  expect(marker.closest("div")?.className).toContain("opacity-50"); // the row is dimmed
});

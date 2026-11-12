import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
  },
];

const edit: EditList = {
  switches: [],
  cuts: [{ start_s: 10, end_s: 20 }],
  tracks: [],
  mix: [],
  disabled: [],
  fps_num: 30000,
  fps_den: 1001,
  width: 1920,
  height: 1080,
};

function setup(
  opts: { edit?: Partial<EditList>; picked?: Picked | null; selection?: [number, number] } = {},
) {
  const handlers = {
    onSeek: vi.fn(),
    onSelect: vi.fn(),
    onCamera: vi.fn(),
    onTrack: vi.fn(),
    onCutChange: vi.fn(),
    onSelectionEdge: vi.fn(),
    onMixChange: vi.fn(),
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
      selection={opts.selection ?? null}
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

test("clicking a segment selects it and moves the playhead to the clicked moment; empty timeline just seeks", () => {
  const h = setup({ edit: { switches: SWITCHES } });
  // Rows: cam 0-30 and 60-100 (switch -1 and 1), cam2 30-60 (switch 0).
  const segs = screen.getAllByTestId("segment");
  expect(segs).toHaveLength(3);
  click(segs[1], 400); // cam2's segment is the second in the rows below cam's
  expect(h.onPick).toHaveBeenCalledWith({ kind: "segment", index: expect.any(Number) });
  expect(h.onSeek).toHaveBeenLastCalledWith(40);

  const lanes = screen.getByTestId("timeline").querySelector(".cursor-crosshair") as HTMLElement;
  click(lanes, 500); // not on a segment or a cut
  expect(h.onSeek).toHaveBeenCalledWith(50);
  expect(h.onPick).toHaveBeenLastCalledWith(null);
});

test("clicking a cut selects it", () => {
  const h = setup();
  click(screen.getByTestId("cut"), 150);
  expect(h.onPick).toHaveBeenCalledWith({ kind: "cut", index: 0 });
  expect(h.onSeek).toHaveBeenLastCalledWith(15);
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
  expect(h.onPreview).toHaveBeenLastCalledWith({
    edit: expect.objectContaining({
      switches: [expect.objectContaining({ at_s: 38 }), SWITCHES[1]],
    }),
    // Cam (before) and Cam 2 (after) are both videos: shown side by side at the frames either side.
    compare: {
      before: "cam",
      after: "cam2",
      tBefore: expect.closeTo(38 - 1001 / 30000, 5),
      tAfter: 38,
    },
  });
  fireEvent.pointerUp(start, { clientX: 380, pointerId: 1 });
  expect(h.onPreview).toHaveBeenLastCalledWith(null);

  const c = setup({ picked: { kind: "cut", index: 0 } });
  const end = screen.getAllByRole("separator", { name: "Drag the end of the cut" })[0];
  drag(end, 200, 260);
  // At an end edge the playhead sits on the last frame of what is being resized.
  expect(c.onScrub).toHaveBeenLastCalledWith(expect.closeTo(26 - 1001 / 30000, 5));
});

test("a selected segment shows grips inside its draggable edges, and only those", () => {
  setup({ edit: { switches: SWITCHES }, picked: { kind: "segment", index: 0 } });
  const seg = screen
    .getAllByTestId("segment")
    .find((g) => g.getAttribute("aria-selected") === "true")!;
  expect(seg.querySelector('[data-grip="start"]')).not.toBeNull();
  expect(seg.querySelector('[data-grip="end"]')).not.toBeNull();
});

test("the opening stretch has no start edge to drag, so no grip there; the last has no end edge", () => {
  setup({ edit: { switches: SWITCHES }, picked: { kind: "segment", index: -1 } });
  const opening = screen
    .getAllByTestId("segment")
    .find((g) => g.getAttribute("aria-selected") === "true")!;
  expect(opening.querySelector('[data-grip="start"]')).toBeNull();
  expect(opening.querySelector('[data-grip="end"]')).not.toBeNull();
});

test("the selected segment or cut is marked by a stripe texture, not an outline", () => {
  setup({ edit: { switches: SWITCHES }, picked: { kind: "segment", index: 0 } });
  const selected = screen
    .getAllByTestId("segment")
    .find((g) => g.getAttribute("aria-selected") === "true")!;
  expect(selected.querySelector('[data-texture="selected"]')).not.toBeNull();
  expect(selected.className).not.toMatch(/border|ring/);
  expect(document.querySelectorAll('[data-texture="selected"]')).toHaveLength(1);
});

test("a selected cut has grips at both edges; an unselected one has none", () => {
  setup({ picked: { kind: "cut", index: 0 } });
  const cut = screen.getByTestId("cut");
  expect(cut.querySelector('[data-grip="start"]')).not.toBeNull();
  expect(cut.querySelector('[data-grip="end"]')).not.toBeNull();
  cleanup();
  setup();
  expect(document.querySelector("[data-grip]")).toBeNull();
});

test("a selected cut is striped too, and unselected ones are not", () => {
  setup({ picked: { kind: "cut", index: 0 } });
  expect(screen.getByTestId("cut").querySelector('[data-texture="selected"]')).not.toBeNull();
  cleanup();
  setup();
  expect(document.querySelector('[data-texture="selected"]')).toBeNull();
});

test("an unselected segment has no grips", () => {
  setup({ edit: { switches: SWITCHES } });
  expect(document.querySelector("[data-grip]")).toBeNull();
});

test("an unselected segment has no drag handles", () => {
  setup({ edit: { switches: SWITCHES } });
  expect(screen.queryByRole("separator", { name: /of the segment/ })).toBeNull();
});

test("the time ruler is pinned (sticky) so it stays put while the rows scroll", () => {
  setup();
  expect(screen.getByTestId("ruler").className).toContain("sticky top-0");
});

test("the playhead is amber, so it never reads as one of the red cut spans", () => {
  setup();
  const playhead = screen.getByTestId("playhead");
  expect(playhead.className).toContain("bg-amber-400");
  expect(playhead.className).not.toContain("red");
});

test("a disabled camera that a segment still shows stays on the timeline, dimmed, with an inert marker instead of a number", () => {
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

test("a disabled camera that no segment shows is off the timeline; a used one stays", () => {
  const offTimeline = (id: string, switches: EditList["switches"]) => {
    cleanup();
    render(
      <Timeline
        media={media}
        offsets={{ cam: 0, cam2: 0, mic: 0 }}
        edit={{ ...edit, disabled: [id], switches }}
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
    return screen.queryByText(id === "cam2" ? "Cam 2" : "Cam") === null;
  };
  expect(offTimeline("cam2", [])).toBe(true); // nothing shows it
  expect(offTimeline("cam2", [{ at_s: 10, media_id: "cam2" }])).toBe(false); // a segment does
});

test("rows for media that can't be read carry a warning flag (cameras and audio); clicking it asks to show the problem", () => {
  const lost = media.map((m) => (m.id === "cam2" || m.id === "mic" ? { ...m, missing: true } : m));
  const onShowProblem = vi.fn();
  const onCamera = vi.fn();
  render(
    <Timeline
      media={lost}
      offsets={{ cam: 0, cam2: 0, mic: 0 }}
      edit={edit}
      peaks={{}}
      playhead={0}
      end={100}
      pxPerSec={10}
      selection={null}
      suggestions={[]}
      onSeek={vi.fn()}
      onSelect={vi.fn()}
      onCamera={onCamera}
      onTrack={vi.fn()}
      picked={null}
      onPick={vi.fn()}
      onShowProblem={onShowProblem}
    />,
  );
  expect(screen.getAllByTestId("missing-flag")).toHaveLength(2);
  expect(screen.queryByRole("img", { name: "Cam can't be read" })).toBeNull();
  expect(screen.getByRole("img", { name: "mic can't be read" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("img", { name: "Cam 2 can't be read" }));
  expect(onShowProblem).toHaveBeenCalledTimes(1);
  expect(onCamera).not.toHaveBeenCalled();
});

const SEL: [number, number] = [10, 50];

test("selection handles show only while there is a selection", () => {
  setup();
  expect(screen.queryByRole("separator", { name: /Selection (start|end)/ })).toBeNull();
  cleanup();
  setup({ selection: SEL });
  expect(screen.getByRole("separator", { name: "Selection start" })).toBeInTheDocument();
  expect(screen.getByRole("separator", { name: "Selection end" })).toBeInTheDocument();
});

test("pressing a selection handle selects it (start = 0, end = 1) and does not seek or select a span", () => {
  const h = setup({ selection: SEL });
  fireEvent.pointerDown(screen.getByRole("separator", { name: "Selection end" }), {
    clientX: 500,
    pointerId: 1,
  });
  expect(h.onPick).toHaveBeenCalledWith({ kind: "edge", index: 1 });
  expect(h.onSeek).not.toHaveBeenCalled();
  expect(h.onSelect).not.toHaveBeenCalled();
});

test("dragging a selection handle moves it, committing once on release, and keeps it clear of the other", () => {
  const h = setup({ selection: SEL, picked: { kind: "edge", index: 0 } });
  const handle = screen.getByRole("separator", { name: "Selection start" });
  drag(handle, 100, 150, 200);
  expect(h.onSelectionEdge).not.toHaveBeenCalled();
  expect(screen.getByText("0:20.00")).toBeInTheDocument(); // the readout while dragging
  fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });
  expect(h.onSelectionEdge).toHaveBeenCalledTimes(1);
  expect(h.onSelectionEdge).toHaveBeenCalledWith(0, 20);
});

test("a selection handle cannot be dragged past the other handle", () => {
  const h = setup({ selection: SEL, picked: { kind: "edge", index: 0 } });
  const handle = screen.getByRole("separator", { name: "Selection start" });
  drag(handle, 100, 900);
  fireEvent.pointerUp(handle, { clientX: 900, pointerId: 1 });
  expect(h.onSelectionEdge).toHaveBeenCalledWith(0, 49.9);
});

test("a click on a selection handle without moving changes nothing", () => {
  const h = setup({ selection: SEL });
  const handle = screen.getByRole("separator", { name: "Selection start" });
  fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });
  expect(h.onSelectionEdge).not.toHaveBeenCalled();
});

const LEVEL = { mix: [{ media_id: "mic", start_s: 20, end_s: 30, gain_db: -6, muted: false }] };

test("clicking an audio level picks it (by its index in the mix); its handles show only when picked", () => {
  const h = setup({ edit: LEVEL });
  expect(screen.queryByRole("separator", { name: /of the level/ })).toBeNull();
  const region = screen.getByTestId("mix-region");
  fireEvent.pointerDown(region, { clientX: 250, pointerId: 1 });
  fireEvent.pointerUp(region, { clientX: 250, pointerId: 1 });
  expect(h.onPick).toHaveBeenCalledWith({ kind: "mix", index: 0 });
  cleanup();
  setup({ edit: LEVEL, picked: { kind: "mix", index: 0 } });
  expect(
    screen.getByRole("separator", { name: "Drag the start of the level" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("separator", { name: "Drag the end of the level" })).toBeInTheDocument();
});

test("dragging a picked level's edge moves it, committing once on release, and keeps it above 0.1 s", () => {
  const h = setup({ edit: LEVEL, picked: { kind: "mix", index: 0 } });
  const handle = screen.getByRole("separator", { name: "Drag the end of the level" });
  drag(handle, 300, 340);
  expect(h.onMixChange).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { clientX: 340, pointerId: 1 });
  expect(h.onMixChange).toHaveBeenCalledWith(0, 20, 34);
  const start = screen.getByRole("separator", { name: "Drag the start of the level" });
  drag(start, 200, 900);
  fireEvent.pointerUp(start, { clientX: 900, pointerId: 1 });
  expect(h.onMixChange).toHaveBeenLastCalledWith(0, 29.9, 30);
});

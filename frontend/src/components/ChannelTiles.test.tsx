import { fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, expect, test, vi } from "vitest";

import type { MediaItem } from "../lib/api";
import { channelsOf } from "../lib/timeline";
import { CameraTile, ChannelTiles, paintFrame } from "./ChannelTiles";

const cam = (id: string, label: string, proxy_ready = true): MediaItem => ({
  id,
  path: `${id}.mp4`,
  kind: "video",
  label,
  duration_s: 100,
  width: 1,
  height: 1,
  fps: 30,
  has_audio: true,
  proxy_ready,
  proxy_building: false,
  included: true,
  missing: false,
  folder: "",
  size_bytes: null,
});
const still: MediaItem = {
  ...cam("car", "car.png"),
  kind: "image",
  duration_s: null,
  has_audio: false,
};
const channels = channelsOf([cam("a", "Cam A"), cam("b", "Cam B"), cam("c", "Cam C"), still]);

/** A <video> that looks decoded: ready, with a size. */
function readyVideo(width = 1920, height = 1080, readyState = 4): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: readyState });
  Object.defineProperty(video, "videoWidth", { value: width });
  Object.defineProperty(video, "videoHeight", { value: height });
  return video;
}

function fakeContext() {
  const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const spy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => ctx as never);
  return { ctx, spy };
}

afterEach(() => vi.restoreAllMocks());

test("a frame is fitted inside the tile on black, centred", () => {
  const { ctx } = fakeContext();
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;

  paintFrame(canvas, readyVideo(1920, 1080));
  expect(ctx.drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 320, 180);

  paintFrame(canvas, readyVideo(640, 480)); // 4:3 is letterboxed, not stretched
  expect(ctx.drawImage).toHaveBeenLastCalledWith(expect.anything(), 40, 0, 240, 180);

  ctx.drawImage.mockClear();
  paintFrame(canvas, readyVideo(0, 0)); // nothing decoded yet: black only
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect(ctx.fillRect).toHaveBeenCalled();
});

const slots = () =>
  [...screen.getByTestId("channel-tiles").children].map((el) => {
    const [, kind, n] = /(camera|still) (\d+)/i.exec(el.getAttribute("aria-label") ?? "") ?? [];
    return { slot: `${kind.toLowerCase()} ${n}`, isButton: el.tagName === "BUTTON" };
  });

const grid = (activeId: string | null, onActivate = vi.fn()) => (
  <ChannelTiles
    slug="show"
    channels={channels}
    activeId={activeId}
    elements={{ current: {} }}
    local={{ a: 1, b: 1, c: 1 }}
    onActivate={onActivate}
  />
);

test("every camera and still has a slot: cameras by number, then stills; the one on screen is a highlighted, inert copy", () => {
  render(grid("a"));
  expect(slots()).toEqual([
    { slot: "camera 1", isButton: false },
    { slot: "camera 2", isButton: true },
    { slot: "camera 3", isButton: true },
    { slot: "still 4", isButton: true },
  ]);
  const placeholder = screen.getByTestId("tile-active");
  expect(placeholder).toHaveAttribute("aria-label", "Camera 1 is on screen");
  expect(placeholder).toHaveTextContent("Cam A"); // still labelled, so you can see which one it is
  expect(screen.queryByRole("button", { name: /camera 1/i })).toBeNull(); // nothing to click
});

test("switching the active channel swaps what is in two slots but never re-orders the grid", () => {
  const { rerender } = render(grid("a"));
  const before = slots().map((s) => s.slot);
  expect(before).toEqual(["camera 1", "camera 2", "camera 3", "still 4"]);

  rerender(grid("c")); // camera 3 goes on screen
  expect(slots()).toEqual([
    { slot: "camera 1", isButton: true }, // camera 1 is a live tile again, in its own slot
    { slot: "camera 2", isButton: true },
    { slot: "camera 3", isButton: false },
    { slot: "still 4", isButton: true },
  ]);

  rerender(grid("car")); // and then the still
  expect(slots().map((s) => s.slot)).toEqual(before);
  expect(slots().map((s) => s.isButton)).toEqual([true, true, true, false]);
  expect(screen.getByTestId("tile-active")).toHaveAttribute("aria-label", "Still 4 is on screen");

  rerender(grid("b"));
  expect(slots().map((s) => s.slot)).toEqual(before);
});

test("a still is a small picture: its proxy when built, the little thumbnail otherwise", () => {
  const { rerender } = render(grid("a"));
  const picture = () =>
    screen.getByRole("button", { name: /Preview of still/ }).querySelector("img");
  expect(picture()?.getAttribute("src")).toBe("/api/projects/show/media/car/proxy");

  const noProxy = channelsOf([cam("a", "Cam A"), { ...still, proxy_ready: false }]);
  rerender(
    <ChannelTiles
      slug="show"
      channels={noProxy}
      activeId="a"
      elements={{ current: {} }}
      local={{ a: 1 }}
      onActivate={vi.fn()}
    />,
  );
  expect(picture()?.getAttribute("src")).toBe("/api/projects/show/media/car/thumb");
});

test("clicking a still's tile activates it, like a camera's", () => {
  const onActivate = vi.fn();
  render(grid("a", onActivate));
  fireEvent.click(screen.getByRole("button", { name: "Preview of still 4: switch to it" }));
  expect(onActivate).toHaveBeenCalledWith("car");
});

test("stills are teal and cameras blue, on the tiles and on the active tile", () => {
  const { rerender } = render(grid("a"));
  const chip = (name: string) => screen.getByRole("button", { name }).querySelector("span.top-1");
  expect(chip("Preview of camera 2: switch to it")?.className).toContain("bg-sky");
  expect(chip("Preview of still 4: switch to it")?.className).toContain("bg-teal");
  rerender(grid("car"));
  expect(screen.getByTestId("tile-active")).toHaveTextContent("on screen");
});

test("clicking a tile activates that camera", () => {
  const onActivate = vi.fn();
  render(
    <ChannelTiles
      slug="show"
      channels={channels}
      activeId="a"
      elements={{ current: {} }}
      local={{ a: 1, b: 1, c: 1 }}
      onActivate={onActivate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview of camera 3: switch to it" }));
  expect(onActivate).toHaveBeenCalledWith("c");
});

test("a tile paints its camera's own element, and repaints when a seek lands", () => {
  const { ctx } = fakeContext();
  const video = readyVideo();
  render(
    <CameraTile
      channel={channels[1]}
      elements={{ current: { b: video } }}
      hasFootage
      proxyReady
      onActivate={vi.fn()}
    />,
  );
  expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);

  ctx.drawImage.mockClear();
  video.dispatchEvent(new Event("seeked")); // a scrub while paused finishes decoding a new frame
  expect(ctx.drawImage).toHaveBeenCalledTimes(1);
});

test("a tile does not paint a camera that is not ready, and says so when there is no footage", () => {
  const { ctx } = fakeContext();
  const { rerender } = render(
    <CameraTile
      channel={channels[1]}
      elements={{ current: { b: readyVideo(1920, 1080, 1) } }}
      hasFootage
      proxyReady
      onActivate={vi.fn()}
    />,
  );
  expect(ctx.drawImage).not.toHaveBeenCalled(); // nothing decoded yet (readyState 1)

  rerender(
    <CameraTile
      channel={channels[1]}
      elements={{ current: { b: readyVideo() } }}
      hasFootage={false}
      proxyReady
      onActivate={vi.fn()}
    />,
  );
  expect(screen.getByText("no footage yet")).toBeInTheDocument();
  expect(ctx.drawImage).not.toHaveBeenCalled(); // never a stale frame from before it started

  rerender(
    <CameraTile
      channel={channels[1]}
      elements={{ current: {} }}
      hasFootage
      proxyReady={false}
      onActivate={vi.fn()}
    />,
  );
  expect(screen.getByText("no proxy")).toBeInTheDocument();
});

test("a disabled channel has no slot at all, and the rest keep their order", () => {
  const off = channelsOf([cam("a", "Cam A"), cam("b", "Cam B"), cam("c", "Cam C"), still], ["b"]);
  render(
    <ChannelTiles
      slug="show"
      channels={off}
      activeId="a"
      elements={{ current: {} }}
      local={{ a: 1, c: 1 }}
      onActivate={vi.fn()}
    />,
  );
  expect(slots().map((s) => s.slot)).toEqual(["camera 1", "camera 2", "still 3"]); // Cam B is gone; Cam C is now 2
  expect(screen.getByTestId("channel-tiles")).not.toHaveTextContent("Cam B");
});

test("the grid is a keypad: 1 2 3 on the bottom row, then 4 5 6, then 7 8 9, trimmed to the rows used", () => {
  const nine = Array.from({ length: 9 }, (_, i) => cam(`c${i + 1}`, `Cam ${i + 1}`));
  const place = (n: number) => {
    const tile = screen.getByRole("button", { name: `Preview of camera ${n}: switch to it` });
    return [Number(tile.style.gridRow), Number(tile.style.gridColumn)];
  };
  const { unmount } = render(
    <ChannelTiles
      slug="show"
      channels={channelsOf(nine)}
      activeId={null}
      elements={{ current: {} }}
      local={{}}
      onActivate={vi.fn()}
    />,
  );
  // [row, column] with row 1 at the top: 7 8 9 / 4 5 6 / 1 2 3.
  expect([7, 8, 9].map(place)).toEqual([
    [1, 1],
    [1, 2],
    [1, 3],
  ]);
  expect([4, 5, 6].map(place)).toEqual([
    [2, 1],
    [2, 2],
    [2, 3],
  ]);
  expect([1, 2, 3].map(place)).toEqual([
    [3, 1],
    [3, 2],
    [3, 3],
  ]);
  unmount();

  // Five channels: no empty row on top; 4 sits above 1 and 5 above 2.
  render(
    <ChannelTiles
      slug="show"
      channels={channelsOf(nine.slice(0, 5))}
      activeId={null}
      elements={{ current: {} }}
      local={{}}
      onActivate={vi.fn()}
    />,
  );
  expect([1, 2, 3, 4, 5].map(place)).toEqual([
    [2, 1],
    [2, 2],
    [2, 3],
    [1, 1],
    [1, 2],
  ]);
});

test("a channel past the ninth has no number and goes below the keypad", () => {
  const eleven = Array.from({ length: 11 }, (_, i) =>
    cam(`c${i + 1}`, `Cam ${String(i + 1).padStart(2, "0")}`),
  );
  render(
    <ChannelTiles
      slug="show"
      channels={channelsOf(eleven)}
      activeId={null}
      elements={{ current: {} }}
      local={{}}
      onActivate={vi.fn()}
    />,
  );
  const extra = screen.getByRole("button", { name: "Preview of camera Cam 10: switch to it" });
  expect([Number(extra.style.gridRow), Number(extra.style.gridColumn)]).toEqual([4, 1]);
  const next = screen.getByRole("button", { name: "Preview of camera Cam 11: switch to it" });
  expect([Number(next.style.gridRow), Number(next.style.gridColumn)]).toEqual([4, 2]);
});

test("a tile whose source file can't be read carries a warning flag; clicking it doesn't cut to the tile", () => {
  const lost = [cam("a", "Cam A"), { ...cam("b", "Cam B"), missing: true, path: "day 1/b.mp4" }];
  const onActivate = vi.fn();
  const onShowProblem = vi.fn();
  render(
    <ChannelTiles
      slug="show"
      channels={channelsOf(lost)}
      activeId={null}
      elements={{ current: {} }}
      local={{}}
      onActivate={onActivate}
      onShowProblem={onShowProblem}
    />,
  );
  // Only the missing camera is flagged, and the flag says which file and why.
  expect(screen.getAllByTestId("missing-flag")).toHaveLength(1);
  const flag = screen.getByRole("img", { name: "Cam B can't be read" });
  expect(flag).toHaveAttribute("title", expect.stringContaining("Can't read day 1/b.mp4"));
  fireEvent.click(flag);
  expect(onShowProblem).toHaveBeenCalledTimes(1);
  expect(onActivate).not.toHaveBeenCalled();
  // The tile itself still works: the preview may be playing from its proxy.
  fireEvent.click(screen.getByRole("button", { name: "Preview of camera 2: switch to it" }));
  expect(onActivate).toHaveBeenCalledWith("b");
});

test("the flag shows on the active tile too, and on a missing still", () => {
  const lost = [
    { ...cam("a", "Cam A"), missing: true },
    { ...still, missing: true },
  ];
  render(
    <ChannelTiles
      slug="show"
      channels={channelsOf(lost)}
      activeId="a"
      elements={{ current: {} }}
      local={{}}
      onActivate={vi.fn()}
    />,
  );
  expect(within(screen.getByTestId("tile-active")).getByTestId("missing-flag")).toBeInTheDocument();
  expect(screen.getAllByTestId("missing-flag")).toHaveLength(2);
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { Workspace } from "./Workspace";

const baseMedia = [
  {
    id: "camA",
    path: "m/a.mp4",
    kind: "video",
    label: "Cam A",
    duration_s: 60,
    width: 3840,
    height: 2160,
    fps: 59.94,
    has_audio: true,
    proxy_ready: true,
  },
  {
    id: "camB",
    path: "m/b.mp4",
    kind: "video",
    label: "Cam B",
    duration_s: 60,
    width: 3840,
    height: 2160,
    fps: 29.97,
    has_audio: true,
    proxy_ready: true,
  },
  {
    id: "mic",
    path: "m/mic.wav",
    kind: "audio",
    label: "mic.wav",
    duration_s: 70,
    width: null,
    height: null,
    fps: null,
    has_audio: true,
    proxy_ready: true,
  },
  {
    id: "car",
    path: "m/car.png",
    kind: "image",
    label: "car.png",
    duration_s: null,
    width: 100,
    height: 50,
    fps: null,
    has_audio: false,
    proxy_ready: true,
  },
];

const synced = (start: number) => ({
  status: "synced",
  start_s: start,
  drift_ppm: 0,
  tone_start_s: 1,
  tone_end_s: 2,
  score: 0.5,
  interval_residual_s: 0,
});

const baseEdit = {
  switches: [],
  cuts: [],
  stills: [],
  tracks: [],
  mix: [],
  range_in_s: null,
  range_out_s: null,
  fps_num: 30000,
  fps_den: 1001,
  width: 1920,
  height: 1080,
};

let media = baseMedia;
let savedEdit: Record<string, unknown> = baseEdit;
let puts: unknown[] = [];
let syncPosts: { template: Record<string, unknown> }[] = [];

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  media = baseMedia;
  savedEdit = baseEdit;
  puts = [];
  syncPosts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, "");
      if (init?.method === "PUT" && path.endsWith("/edit")) {
        puts.push(JSON.parse(init.body as string));
        return respond({ edit: puts[puts.length - 1], needs_upgrade: false });
      }
      if (path.endsWith("/renders"))
        return respond([{ name: "show-20260101-000000.mp4", size: 18200000 }]);
      if (init?.method === "POST" && path.endsWith("/render"))
        return respond({
          id: "r1",
          label: "render",
          state: "running",
          progress: 0,
          message: "",
          error: null,
          result: null,
        });
      if (path === "/jobs/r1")
        return respond({
          id: "r1",
          label: "render",
          state: "done",
          progress: 1,
          message: "",
          error: null,
          result: { name: "show-20260101-000001.mp4" },
        });
      if (init?.method === "POST" && path.endsWith("/sync")) {
        syncPosts.push(JSON.parse(init.body as string));
        return respond({
          id: "s1",
          label: "sync",
          state: "running",
          progress: 0,
          message: "",
          error: null,
          result: null,
        });
      }
      if (path === "/jobs/s1")
        return respond({
          id: "s1",
          label: "sync",
          state: "done",
          progress: 1,
          message: "",
          error: null,
          result: { synced: 3, files: 3 },
        });
      if (path.startsWith("/library/files"))
        return respond({
          dir: "",
          parent: null,
          entries: [
            {
              name: "reference.wav",
              path: "reference.wav",
              is_dir: false,
              kind: "audio",
              size: 1000,
            },
            { name: "cam.mp4", path: "cam.mp4", is_dir: false, kind: "video", size: 1000 },
          ],
        });
      if (path.endsWith("/media")) return respond(media);
      if (path.endsWith("/sync"))
        return respond({
          template: null,
          nudges: {},
          needs_upgrade: false,
          results: { camA: synced(5), camB: synced(10), mic: synced(0) },
        });
      if (path.endsWith("/edit")) return respond({ edit: savedEdit, needs_upgrade: false });
      if (path.endsWith("/plan"))
        return respond({
          duration_s: 70,
          warnings: ["Cam B has no footage for part of the selected range"],
        });
      if (path.includes("/peaks"))
        return respond({ rate: 100, floor_db: -80, values: [0, 100, 200] });
      if (path.endsWith("/projects/show"))
        return respond({
          slug: "show",
          name: "Show",
          created_at: "2026-01-01T00:00:00Z",
          needs_upgrade: true,
        });
      return respond({}, 404);
    }),
  );
});

test("loads a project, shows its media, timeline rows, warnings and the format notice", async () => {
  render(<Workspace slug="show" />);
  await waitFor(() => expect(screen.getByText("Show")).toBeInTheDocument());
  expect(await screen.findByTestId("timeline")).toBeInTheDocument();
  expect(screen.getAllByText("Cam A").length).toBeGreaterThan(0);
  expect(screen.getByRole("slider", { name: "Gain mic.wav" })).toBeInTheDocument();
  expect(await screen.findByText(/Cam B has no footage/)).toBeInTheDocument();
  expect(screen.getByText(/Saved by an older Edith/)).toBeInTheDocument();
});

test("switching camera marks the edit unsaved; saving sends it and clears the mark", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  expect(screen.queryByText("unsaved changes")).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: "Switch to camera 2" }));
  expect(screen.getByText("unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Switches \(1\)/ }));
  expect(screen.getByText(/→ Camera 2/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0] as typeof baseEdit).switches).toEqual([{ at_s: 0, media_id: "camB" }]);
  await waitFor(() => expect(screen.queryByText("unsaved changes")).toBeNull());
});

test("undo reverts a change", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  fireEvent.click(await screen.findByRole("button", { name: "Switch to camera 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.queryByText("unsaved changes")).toBeNull();
});

test("a file's audio is switched off from the Media tab, and the number keys edit the timeline", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  expect(screen.queryByLabelText("Mute mic.wav")).toBeNull(); // no longer a timeline control
  expect(screen.getByRole("slider", { name: "Gain mic.wav" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: /Media/ }));
  const use = await screen.findByLabelText("Use audio from mic.wav");
  expect(use).toBeChecked();
  expect(screen.getByLabelText("Use audio from Cam A")).not.toBeChecked(); // camera audio is off
  expect(screen.queryByLabelText("Use audio from car.png")).toBeNull(); // pictures have none
  fireEvent.click(use);
  expect(screen.getByText("unsaved changes")).toBeInTheDocument();
  expect(screen.queryByRole("slider", { name: "Gain mic.wav" })).toBeNull(); // its row is gone

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0] as typeof baseEdit).tracks).toEqual([
    { media_id: "mic", gain_db: 0, muted: true },
  ]);

  fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
  fireEvent.keyDown(window, { key: "2" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Switches \(1\)/ })).toBeInTheDocument(),
  );
});

test("renders from the export section and lists finished renders", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  fireEvent.click(await screen.findByRole("tab", { name: "Export" }));
  fireEvent.click(await screen.findByRole("button", { name: /Renders \(1\)/ }));
  expect(await screen.findByText("show-20260101-000000.mp4")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Render MP4 (1080p)" }));
  const calls = () => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  await waitFor(() =>
    expect(
      calls().some(
        ([url, init]) =>
          String(url).endsWith("/render") && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(true),
  );
});

test("the ribbon opens on the next step, switches tabs, and never changes height", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  const ribbon = screen.getByTestId("ribbon");
  const height = ribbon.style.height;
  expect(height).not.toBe("");

  // Synced project: it opens on Edit, and the timeline and player stay on screen throughout.
  expect(screen.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "Switch to camera 1" })).toBeInTheDocument();

  const tabs: [string, RegExp][] = [
    ["Media (4)", /Add media/],
    ["Sync", /Find the sound in every file/],
    ["Export", /Render MP4/],
    ["Edit", /Cut \(x\)/],
  ];
  for (const [tab, content] of tabs) {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab.replace(/[()]/g, "\\$&")) }));
    expect(await screen.findByRole("button", { name: content })).toBeInTheDocument();
    expect(screen.getByTestId("ribbon").style.height).toBe(height);
    expect(screen.getByTestId("timeline")).toBeInTheDocument();
    expect(screen.getByTestId("player")).toBeInTheDocument();
  }
});

test("the media tab shows tiny thumbnails for video and images, not audio", async () => {
  const { container } = render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  fireEvent.click(screen.getByRole("tab", { name: /Media/ }));
  await screen.findByRole("button", { name: "Add media…" });
  const sources = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
  expect(sources.sort()).toEqual(
    ["camA", "camB", "car"].map((id) => `/api/projects/show/media/${id}/thumb`).sort(),
  );
});

const still = (id: string) => ({
  id,
  path: `m/${id}.jpg`,
  kind: "image",
  label: `${id}.jpg`,
  duration_s: null,
  width: 100,
  height: 50,
  fps: null,
  has_audio: false,
  proxy_ready: true,
});

test("stills are numbered after the cameras; their number key cuts to the still", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  // Cam A = 1, Cam B = 2, car.png = 3
  expect(await screen.findByRole("button", { name: "Switch to still 3" })).toBeInTheDocument();

  fireEvent.keyDown(window, { key: "3" });
  fireEvent.click(await screen.findByRole("button", { name: /Switches \(1\)/ }));
  expect(screen.getByText(/→ Still 3 · car\.png/)).toBeInTheDocument();

  // ...and a camera's number cuts back, like any channel (later on, not at the same instant).
  fireEvent.keyDown(window, { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByText("0:01.00")).toBeInTheDocument());
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Switches \(2\)/ })).toBeInTheDocument(),
  );
});

test("each still has its own timeline row, grouped under a Stills disclosure", async () => {
  media = [...baseMedia, still("bike")];
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  const toggle = await within(timeline).findByRole("button", { name: /Stills \(2\)/ });
  expect(toggle).toHaveAttribute("aria-expanded", "true"); // few stills: open by default
  expect(within(timeline).getByRole("button", { name: "Switch to bike.jpg" })).toBeInTheDocument();
  expect(within(timeline).getByRole("button", { name: "Switch to car.png" })).toBeInTheDocument();

  fireEvent.click(toggle);
  expect(within(timeline).queryByRole("button", { name: "Switch to bike.jpg" })).toBeNull();
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("with many stills the group starts collapsed, and only nine channels get numbers", async () => {
  media = [
    ...baseMedia.filter((m) => m.kind !== "image"),
    ...Array.from({ length: 8 }, (_, i) => still(`s${i}`)),
  ];
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  const toggle = await within(timeline).findByRole("button", { name: /Stills \(8\)/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // 2 cameras + 8 stills: stills 3-9 are numbered, the last one is not.
  expect(screen.getByRole("button", { name: "Switch to still 9" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Switch to still 10" })).toBeNull();
});

describe("choosing the registration sound", () => {
  const openSync = async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    fireEvent.click(screen.getByRole("tab", { name: /Sync/ }));
    return screen.findByLabelText("Registration sound source");
  };

  test("a generated sound: type the text, download link follows it, and the seed is sent", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "seed" } });
    const find = screen.getByRole("button", { name: "Find the sound in every file" });
    expect(find).toBeDisabled(); // no text yet

    fireEvent.input(screen.getByLabelText("Registration text"), {
      target: { value: "stickshift" },
    });
    expect(screen.getByRole("link", { name: "Download .wav" })).toHaveAttribute(
      "href",
      "/api/registration/sound?seed=stickshift",
    );
    fireEvent.click(find);
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "seed", seed: "stickshift" });
  });

  test("an audio file: only audio is offered, and its path is sent", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "file" } });
    const find = screen.getByRole("button", { name: "Find the sound in every file" });
    expect(find).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Choose file…" }));
    expect(await screen.findByText("reference.wav")).toBeInTheDocument();
    expect(screen.queryByText("cam.mp4")).toBeNull(); // video is filtered out
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "Use this file" }));

    await waitFor(() => expect(find).toBeEnabled());
    fireEvent.click(find);
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "file", path: "reference.wav" });
  });

  test("marking it in a recording is still there and sends the excerpt", async () => {
    const source = await openSync();
    expect(source).toHaveValue("excerpt");
    expect(screen.getByLabelText("Recording")).toBeInTheDocument();
    expect(screen.getByText(/Drag across the beep/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find the sound in every file" })).toBeDisabled();
  });

  test("shows how well each file matched", async () => {
    await openSync();
    expect((await screen.findAllByText("0.50")).length).toBe(3);
  });
});

test("mixing a stretch of one track: select it, set a level, see it on the track, and save it", async () => {
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  expect(screen.getByRole("button", { name: "Set" })).toBeDisabled(); // nothing selected yet

  // Drag across the timeline: in jsdom the lanes start at x=0 and run at 20 px per second.
  const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
  fireEvent.pointerDown(lanes, { clientX: 200, pointerId: 1 });
  fireEvent.pointerMove(lanes, { clientX: 400, pointerId: 1 });
  fireEvent.pointerUp(lanes, { clientX: 400, pointerId: 1 });

  fireEvent.change(screen.getByLabelText("Level change (dB)"), { target: { value: "-8" } });
  fireEvent.click(screen.getByRole("button", { name: "Set" }));
  expect(within(timeline).getByText("-8 dB")).toBeInTheDocument(); // drawn on the mic's row

  fireEvent.click(screen.getByRole("button", { name: /Mix \(1\)/ }));
  expect(screen.getByText(/0:10\.0 – 0:20\.0 mic\.wav -8 dB/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0] as { mix: unknown[] }).mix).toEqual([
    { media_id: "mic", start_s: 10, end_s: 20, gain_db: -8, muted: false },
  ]);
});

test("muting a stretch shows it as muted on the track", async () => {
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
  fireEvent.pointerDown(lanes, { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(lanes, { clientX: 160, pointerId: 1 });
  fireEvent.pointerUp(lanes, { clientX: 160, pointerId: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  expect(within(timeline).getByText("muted")).toBeInTheDocument();
});

describe("where the playhead starts", () => {
  test("on the first moment that is not cut when the project opens", async () => {
    savedEdit = { ...baseEdit, cuts: [{ start_s: 0, end_s: 14.05 }] };
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    await waitFor(() => expect(screen.getByText("0:14.05")).toBeInTheDocument());
    expect(screen.getByText(/output 0:00\.00/)).toBeInTheDocument(); // the start of the output
  });

  test("at zero when nothing is cut at the start", async () => {
    savedEdit = { ...baseEdit, cuts: [{ start_s: 20, end_s: 30 }] };
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    expect(screen.getByText("0:00.00")).toBeInTheDocument();
  });

  test("Start returns to the first kept moment, not to zero", async () => {
    savedEdit = { ...baseEdit, cuts: [{ start_s: 0, end_s: 14.05 }] };
    render(<Workspace slug="show" />);
    await waitFor(() => expect(screen.getByText("0:14.05")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("0:15.05")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(screen.getByText("0:14.05")).toBeInTheDocument());
  });
});

test("channel buttons share one palette in the ribbon and on the timeline", async () => {
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  const ribbonCamera = await screen.findByRole("button", { name: "Switch to camera 1" });
  const ribbonStill = screen.getByRole("button", { name: "Switch to still 3" });
  const rowCamera = within(timeline).getByRole("button", { name: "Switch to Cam A" });
  const rowStill = within(timeline).getByRole("button", { name: "Switch to car.png" });

  for (const chip of [ribbonCamera, rowCamera]) expect(chip.className).toContain("bg-sky");
  for (const chip of [ribbonStill, rowStill]) expect(chip.className).toContain("bg-teal");
  for (const chip of [ribbonCamera, ribbonStill, rowCamera, rowStill]) {
    expect(chip.className).not.toMatch(/neutral|fuchsia|purple|violet/);
  }
});

describe("icons", () => {
  // Characters that used to stand in for icons: they must not creep back into any tab.
  const STAND_INS = /[▾▸✕⚠📁🔊♪↑←⏮]/u;

  test("every tab uses icons, not text glyphs, and every button still has a name", async () => {
    const { container } = render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    for (const tab of [/Media/, /Sync/, /Edit/, /Export/]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      await screen.findByRole("tabpanel");
      expect(container.textContent).not.toMatch(STAND_INS);
      for (const button of screen.getAllByRole("button")) expect(button).toHaveAccessibleName();
    }
    // The tabs themselves carry icons.
    for (const tab of screen.getAllByRole("tab")) expect(tab.querySelector("svg")).not.toBeNull();
  });

  test("the controls people press most carry icons", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    for (const name of ["Undo", "Redo", "Save", "Play (space)", "Zoom in", "Start"]) {
      const button = screen.getAllByRole("button", {
        name: new RegExp(name.replace(/[()]/g, "\\$&")),
      })[0];
      expect(button.querySelector("svg"), name).not.toBeNull();
    }
  });
});

describe("the other cameras beside the active view", () => {
  test("show the cameras that are not on screen; clicking one cuts to it at the playhead", async () => {
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("camera-tiles");
    // Cam A is on screen (it starts first), so only Cam B (camera 2) is offered. Waiting for its
    // tile also waits for the media to load, which the timeline length depends on.
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced"); // loading is finished; the playhead has been placed
    expect(within(tiles).getAllByRole("button")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("0:01.00")).toBeInTheDocument());

    const order = () =>
      [...tiles.children].map(
        (el) => /camera (\d+)/i.exec(el.getAttribute("aria-label") ?? "")?.[1],
      );
    expect(order()).toEqual(["1", "2"]); // camera 1's slot holds the placeholder
    expect(within(tiles).getByTestId("tile-placeholder")).toHaveAttribute(
      "aria-label",
      "Camera 1 is on screen",
    );

    fireEvent.click(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    );
    expect(screen.getByText("unsaved changes")).toBeInTheDocument();
    // Now camera 1 is the one on the side, in its own slot: swapping did not move any tile.
    expect(
      await within(tiles).findByRole("button", { name: "Preview of camera 1: switch to it" }),
    ).toBeInTheDocument();
    expect(within(tiles).queryByRole("button", { name: /camera 2/ })).toBeNull();
    expect(order()).toEqual(["1", "2"]);
    expect(within(tiles).getByTestId("tile-placeholder")).toHaveAttribute(
      "aria-label",
      "Camera 2 is on screen",
    );

    fireEvent.click(screen.getByRole("button", { name: /Switches \(1\)/ }));
    expect(screen.getByText(/0:01\.0 → Camera 2/)).toBeInTheDocument();
  });

  test("the transport sits under the active view and the zoom controls moved to the timeline", async () => {
    render(<Workspace slug="show" />);
    const timeline = await screen.findByTestId("timeline");
    expect(within(timeline).getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: "Fit" })).toBeInTheDocument();
    const player = screen.getByTestId("player");
    const play = screen.getByRole("button", { name: /Play \(space\)/ });
    // Same column as the player: the play button is not inside the camera tiles or the timeline.
    expect(player.closest(".flex-col")?.contains(play)).toBe(true);
    expect(screen.getByTestId("camera-tiles").contains(play)).toBe(false);
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { EditList } from "../lib/api";
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
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
    proxy_building: false,
    included: true,
    missing: false,
    folder: "",
    size_bytes: null,
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
  disabled: [],
  encoding: "h264",
  fps_num: 30000,
  fps_den: 1001,
  width: 1920,
  height: 1080,
};

let media = baseMedia;
let savedEdit: Record<string, unknown> = baseEdit;
let puts: unknown[] = [];
let mediaPosts: { path: string }[] = [];
let relinks: { from: string; path: string }[] = [];
let syncPosts: { template: Record<string, unknown> }[] = [];
let inspectAnswer: Record<string, unknown> = {};

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
  mediaPosts = [];
  relinks = [];
  syncPosts = [];
  inspectAnswer = { found: true, offset_s: 0.5, code: "1387DE4E", confidence: 0.97 };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, "");
      if (init?.method === "PUT" && path.endsWith("/edit")) {
        puts.push(JSON.parse(init.body as string));
        return respond({ edit: puts[puts.length - 1], needs_upgrade: false });
      }
      if (path.endsWith("/renders"))
        return respond([
          {
            name: "show-20260101-000000.mp4",
            size: 18200000,
            modified: "2026-01-01T09:30:00+00:00",
          },
        ]);
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
      if (path.includes("/sync/inspect")) {
        const start = Number(new URLSearchParams(path.split("?")[1]).get("start_s"));
        // The burst is at 5.5 s: a stretch that starts there already starts at the burst.
        return respond(
          inspectAnswer.found
            ? { ...inspectAnswer, offset_s: Math.max(0.005, 5.5 - start) }
            : inspectAnswer,
        );
      }
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
      if (init?.method === "POST" && path.endsWith("/relink")) {
        const body = JSON.parse(init.body as string) as { path: string };
        const from = path.split("/media/")[1].split("/")[0];
        relinks.push({ from, path: body.path });
        const target = media.find((m) => m.path === body.path)!;
        media = media
          .filter((m) => m.id !== from)
          .map((m) => (m.id === target.id ? { ...m, included: true } : m));
        return respond(media.find((m) => m.id === target.id));
      }
      if (init?.method === "POST" && path.endsWith("/media")) {
        const body = JSON.parse(init.body as string) as { path: string };
        mediaPosts.push(body);
        media = media.map((m) => (m.path === body.path ? { ...m, included: true } : m));
        return respond(
          media.find((m) => m.path === body.path),
          201,
        );
      }
      if (path.includes("/details"))
        return respond({
          container: "QuickTime / MOV",
          size_bytes: 1_500_000,
          duration_s: 60,
          bit_rate: 8_000_000,
          created: null,
          video: {
            codec: "h264",
            profile: "High",
            width: 3840,
            height: 2160,
            fps: 59.94,
            fps_variable: false,
            pix_fmt: "yuv420p",
            bit_depth: 8,
            color_space: "bt709",
            color_range: "tv",
            color_transfer: null,
            bit_rate: 7_000_000,
          },
          audio: null,
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
          warnings: ["Cam B has no footage for part of the timeline"],
        });
      if (path.includes("/peaks"))
        return respond({ rate: 100, floor_db: -80, values: [0, 100, 200] });
      if (path.endsWith("/projects/show"))
        return respond({
          slug: "show",
          name: "Show",
          folder: "/Volumes/SSD/show",
          created_at: "2026-01-01T00:00:00Z",
          needs_upgrade: true,
          available: true,
          last_opened: null,
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

test("a waveform that can't be read says which file, and Retry loads it once it is back", async () => {
  const working = globalThis.fetch;
  let peakCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/peaks") && peakCalls++ === 0)
        return new Response(
          JSON.stringify({ detail: "MediaNotFound", message: "Can't read mic.wav" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      return working(url, init);
    }),
  );
  render(<Workspace slug="show" />);
  expect(await screen.findByText("Can't read mic.wav")).toBeInTheDocument(); // no status-code prefix

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText("Can't read mic.wav")).toBeNull());
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("switching camera marks the edit unsaved; saving sends it and clears the mark", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  expect(screen.queryByText("unsaved changes")).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: "Preview of camera 2: switch to it" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Preview of camera 2: switch to it" }));
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
  // Each render says when it was made, and how big it is.
  expect(screen.getByText(/2026.*MB/)).toBeInTheDocument();
  expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: /Cut \(x\)/ })).toBeInTheDocument(); // the Edit tools

  const tabs: [string, RegExp][] = [
    ["Media (4)", /Add all/],
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
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  fireEvent.click(screen.getByRole("tab", { name: /Media/ }));
  await screen.findAllByTestId("media-card");
  // Only the ribbon's pictures: the stage has one of its own for the still's tile.
  const sources = [...screen.getByRole("tabpanel").querySelectorAll("img")].map((img) =>
    img.getAttribute("src"),
  );
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
  proxy_building: false,
  included: true,
  missing: false,
  folder: "",
  size_bytes: null,
});

test("stills are numbered after the cameras; their number key cuts to the still", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  // Cam A = 1, Cam B = 2, car.png = 3
  expect(
    await screen.findByRole("button", { name: "Preview of still 3: switch to it" }),
  ).toBeInTheDocument();

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
  expect(
    screen.getByRole("button", { name: "Preview of still 9: switch to it" }),
  ).toBeInTheDocument();
  // ...the 10th channel has no number, so its tile is labelled by name.
  expect(screen.queryByRole("button", { name: "Preview of still 10: switch to it" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Preview of still s7.jpg: switch to it" }),
  ).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: /Download the sound/ })).toHaveAttribute(
      "href",
      "/api/registration/sound?seed=stickshift",
    );
    // Saved as <seed>.wav, with nothing in the name a file can't hold.
    expect(screen.getByRole("link", { name: /Download the sound/ })).toHaveAttribute(
      "download",
      "stickshift.wav",
    );
    fireEvent.input(screen.getByLabelText("Registration text"), { target: { value: "a/b" } });
    expect(screen.getByRole("link", { name: /Download the sound/ })).toHaveAttribute(
      "download",
      "a-b.wav",
    );
    fireEvent.input(screen.getByLabelText("Registration text"), {
      target: { value: "stickshift" },
    });
    fireEvent.click(find);
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "seed", seed: "stickshift" });
  });

  test("a typed seed becomes a modified project setting (Save keeps it), and Find uses it without a file", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "seed" } });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled(); // nothing changed yet
    const field = screen.getByLabelText("Registration text");
    fireEvent.input(field, { target: { value: "stick" } });
    fireEvent.input(field, { target: { value: "stickshift" } });
    // A moment after the last keystroke the edit changes: the project is marked modified, not saved.
    await waitFor(() => expect(save).toBeEnabled());
    expect(puts).toHaveLength(0);
    fireEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ registration: { kind: "seed", seed: "stickshift" } });
    // Find then uses the seed straight away.
    fireEvent.click(screen.getByRole("button", { name: "Find the sound in every file" }));
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "seed", seed: "stickshift" });
  });

  test("a committed seed is searched for at once: Enter or leaving the field, once per seed", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "seed" } });
    const field = screen.getByLabelText("Registration text");
    fireEvent.input(field, { target: { value: "stickshift" } });
    expect(syncPosts).toHaveLength(0); // typing alone searches nothing
    fireEvent.blur(field); // leaving the field commits it
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "seed", seed: "stickshift" });
    fireEvent.keyDown(field, { key: "Enter" }); // the same seed again: nothing new to find
    fireEvent.blur(field);
    await new Promise((r) => setTimeout(r, 100));
    expect(syncPosts).toHaveLength(1);
    // A different seed, committed with Enter, searches again.
    fireEvent.input(field, { target: { value: "another" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(syncPosts).toHaveLength(2));
    expect(syncPosts[1].template).toEqual({ kind: "seed", seed: "another" });
  });

  test("a chosen audio file changes the project setting too, and Undo takes it back", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "file" } });
    fireEvent.change(await screen.findByRole("combobox", { name: "Audio file" }), {
      target: { value: "m/mic.wav" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  test("a project's saved sound is shown without marking it modified", async () => {
    savedEdit = { ...baseEdit, registration: { kind: "seed", seed: "stickshift" } };
    const source = await openSync();
    await waitFor(() => expect(source).toHaveValue("seed"));
    expect(screen.getByLabelText("Registration text")).toHaveValue("stickshift");
    await new Promise((r) => setTimeout(r, 700)); // longer than the debounce
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("Enter in the seed field downloads the sound, like the button", async () => {
    const clicks: { href: string; download: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.getAttribute("href") ?? "", download: this.download });
    });
    const source = await openSync();
    fireEvent.change(source, { target: { value: "seed" } });
    const field = screen.getByLabelText("Registration text");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(clicks).toEqual([]); // nothing typed: nothing to download
    fireEvent.input(field, { target: { value: "  my show " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(clicks).toEqual([
      { href: "/api/registration/sound?seed=my%20show", download: "my show.wav" },
    ]);
    click.mockRestore();
  });

  test("an audio file of the project folder: only audio is offered, and its path is sent", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "file" } });
    const find = screen.getByRole("button", { name: "Find the sound in every file" });
    expect(find).toBeDisabled();

    const choose = await screen.findByRole("combobox", { name: "Audio file" });
    const offered = within(choose)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(offered).toContain("m/mic.wav");
    expect(offered.some((o) => /\.mp4$/.test(o ?? ""))).toBe(false); // video is not offered
    fireEvent.change(choose, { target: { value: "m/mic.wav" } });

    await waitFor(() => expect(find).toBeEnabled());
    fireEvent.click(find);
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "file", path: "m/mic.wav" });
  });

  test("marking it in a recording is still there and sends the excerpt", async () => {
    const source = await openSync();
    expect(source).toHaveValue("excerpt");
    expect(screen.getByLabelText("Recording")).toBeInTheDocument();
    expect(screen.getByText(/Drag across the beep/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find the sound in every file" })).toBeDisabled();
  });

  test("Find sits with the source drop-down and buttons in the Registration sound panel, with a file-search icon", async () => {
    const source = await openSync();
    const find = screen.getByRole("button", { name: "Find the sound in every file" });
    // One ribbon grid holds the source drop-down, the buttons and Find: the first panel.
    const grid = (el: HTMLElement) => el.closest("div.grid");
    expect(grid(find)).not.toBeNull();
    expect(grid(find)).toBe(grid(source));
    expect(grid(find)).toBe(
      grid(within(screen.getByTestId("ribbon")).getByRole("button", { name: "Zoom in" })),
    );
    expect(find.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("file-search");
  });

  test("zoom is one joined stack right of the waveform (in above out); the first row stays full width", async () => {
    await openSync();
    const ribbon = screen.getByTestId("ribbon");
    const zoomIn = within(ribbon).getByRole("button", { name: "Zoom in" });
    const zoomOut = within(ribbon).getByRole("button", { name: "Zoom out" });
    // Both buttons are in the same stack: no gap between them, in on top, in the last column.
    const stack = zoomIn.parentElement!;
    expect(zoomOut.parentElement).toBe(stack);
    expect([...stack.children]).toEqual([zoomIn, zoomOut]);
    expect(stack).toHaveStyle({ gridColumn: "17", gridRow: "2 / span 2" });
    expect(zoomIn.className).toContain("rounded-tr-[5px]"); // rounded only on the outside
    expect(zoomOut.className).toContain("rounded-br-[5px]");
    expect(zoomIn.className).not.toContain("rounded-br");
    // The waveform's box is square on the right, where it meets them, and reaches across the gap.
    const cell = ribbon.querySelector(".cursor-crosshair")!.parentElement!.parentElement!;
    expect(cell).toHaveStyle({ gridColumn: "span 16", marginRight: "-5px" });
    expect(cell.firstElementChild!.className).toContain("rounded-l-[5px]");
    expect(cell.firstElementChild!.className).not.toContain("rounded-[5px]");
    // The recording drop-down takes up the slack: source 5 + recording 9 + two play buttons + Find = 17.
    const recording = screen.getByLabelText("Recording").closest("div.min-w-0") as HTMLElement;
    expect(recording).toHaveStyle({ gridColumn: "span 9" });
  });

  test("marked in a recording: play the whole recording or just the selection, to check it", async () => {
    const played: { src: string; from: number }[] = [];
    let paused = 0;
    vi.stubGlobal(
      "Audio",
      class {
        src: string;
        currentTime = 0;
        ended = false;
        constructor(src: string) {
          this.src = src;
        }
        play() {
          played.push({ src: this.src, from: this.currentTime });
          return Promise.resolve();
        }
        pause() {
          paused += 1;
        }
      },
    );
    await openSync();
    const ribbon = screen.getByTestId("ribbon");
    const whole = within(ribbon).getByRole("button", { name: "Play the whole recording" });
    const part = within(ribbon).getByRole("button", { name: "Play just the selection" });
    expect(whole).toBeEnabled();
    expect(part).toBeDisabled(); // nothing marked yet

    // Mark 5 s to 10 s on the waveform (20 px per second in jsdom).
    const wave = ribbon.querySelector(".cursor-crosshair") as HTMLElement;
    fireEvent.pointerDown(wave, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(wave, { clientX: 200, pointerId: 1 });
    expect(part).toBeEnabled();

    fireEvent.click(part);
    expect(played).toHaveLength(1);
    expect(played[0].src).toMatch(/\/media\/.+\/proxy$/);
    expect(played[0].from).toBeCloseTo(5, 1); // starts at the marked stretch
    expect(within(ribbon).getByTestId("sync-playhead")).toBeInTheDocument();
    // Pressing it again stops it; the whole recording starts from the top.
    fireEvent.click(within(ribbon).getByRole("button", { name: "Stop the selection" }));
    expect(paused).toBe(1);
    expect(within(ribbon).queryByTestId("sync-playhead")).toBeNull();
    fireEvent.click(whole);
    expect(played).toHaveLength(2);
    expect(played[1].from).toBe(0);
    // Starting the selection while the recording plays stops the recording first.
    fireEvent.click(within(ribbon).getByRole("button", { name: "Play just the selection" }));
    expect(paused).toBe(2);
    expect(played).toHaveLength(3);
    vi.unstubAllGlobals();
  });

  test("clicking the waveform sets where the whole recording plays from, even while it plays", async () => {
    const created: { currentTime: number; played: number }[] = [];
    vi.stubGlobal(
      "Audio",
      class {
        currentTime = 0;
        ended = false;
        played = 0;
        constructor() {
          created.push(this);
        }
        play() {
          this.played += 1;
          return Promise.resolve();
        }
        pause() {}
      },
    );
    await openSync();
    const ribbon = screen.getByTestId("ribbon");
    const wave = ribbon.querySelector(".cursor-crosshair") as HTMLElement;
    const click = (x: number) => {
      fireEvent.pointerDown(wave, { clientX: x, pointerId: 1 });
      fireEvent.pointerUp(wave, { clientX: x, pointerId: 1 });
    };
    expect(within(ribbon).queryByTestId("sync-playhead")).toBeNull();
    click(300); // 15 s (20 px per second in jsdom)
    expect(within(ribbon).getByTestId("sync-playhead")).toHaveStyle({ left: "300px" });
    // A click is not a selection: the play-selection button stays off.
    expect(within(ribbon).getByRole("button", { name: "Play just the selection" })).toBeDisabled();

    fireEvent.click(within(ribbon).getByRole("button", { name: "Play the whole recording" }));
    expect(created[0].currentTime).toBeCloseTo(15, 1); // from the playhead, not the top
    click(500); // skip ahead while it plays
    expect(created[0].currentTime).toBeCloseTo(25, 1);
    expect(created).toHaveLength(1); // the same playback, moved
    // Stopping leaves the playhead where you put it, and the button is Stop, not Pause.
    const stop = within(ribbon).getByRole("button", { name: "Stop the recording" });
    expect(stop.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("stop-square");
    fireEvent.click(stop);
    expect(within(ribbon).getByTestId("sync-playhead")).toHaveStyle({ left: "500px" });
    vi.unstubAllGlobals();
  });

  test("dragging across the waveform marks a stretch and does not move the playhead", async () => {
    await openSync();
    const ribbon = screen.getByTestId("ribbon");
    const wave = ribbon.querySelector(".cursor-crosshair") as HTMLElement;
    fireEvent.pointerDown(wave, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 140, pointerId: 1 });
    fireEvent.pointerUp(wave, { clientX: 140, pointerId: 1 });
    expect(within(ribbon).getByText(/Selected 0:05\.00 – 0:07\.00/)).toBeInTheDocument();
    expect(within(ribbon).queryByTestId("sync-playhead")).toBeNull();
  });

  test("a marked stretch is decoded: it says whether a registration sound is in it, and shows where", async () => {
    await openSync();
    const ribbon = screen.getByTestId("ribbon");
    const wave = ribbon.querySelector(".cursor-crosshair") as HTMLElement;
    const mark = (from: number, to: number) => {
      fireEvent.pointerDown(wave, { clientX: from, pointerId: 1 });
      fireEvent.pointerMove(wave, { clientX: to, pointerId: 1 });
      fireEvent.pointerUp(wave, { clientX: to, pointerId: 1 });
    };
    mark(100, 200); // 5 s to 10 s
    const result = await within(ribbon).findByTestId("decode-result");
    expect(result).toHaveTextContent("Registration sound found · code 1387DE4E");
    // The burst is marked on the waveform where it was read (5 s + 0.5 s, 0.2 s long).
    expect(within(ribbon).getByTestId("decoded-burst")).toHaveStyle({
      left: "110px",
      width: "4px",
    });
    // Nothing there: it says so, with no band.
    inspectAnswer = { found: false, offset_s: null, code: null, confidence: null };
    mark(300, 400);
    await waitFor(() =>
      expect(within(ribbon).getByTestId("decode-result")).toHaveTextContent(
        "No registration sound",
      ),
    );
    expect(within(ribbon).queryByTestId("decoded-burst")).toBeNull();
  });

  test("a stretch with a burst in it is trimmed to the burst; one without is left alone", async () => {
    await openSync();
    const ribbon = screen.getByTestId("ribbon");
    const wave = ribbon.querySelector(".cursor-crosshair") as HTMLElement;
    const mark = (from: number, to: number) => {
      fireEvent.pointerDown(wave, { clientX: from, pointerId: 1 });
      fireEvent.pointerMove(wave, { clientX: to, pointerId: 1 });
      fireEvent.pointerUp(wave, { clientX: to, pointerId: 1 });
    };
    mark(100, 200); // 5 s to 10 s, with the burst read at 5.5 s
    await waitFor(() =>
      expect(
        within(ribbon).getByText(/Selected 0:05\.(49|50) – 0:05\.(70|71) \(0\.21 s\)/),
      ).toBeInTheDocument(),
    );
    // Stable: it was read again at the start of the trimmed stretch, and left as it is.
    await new Promise((r) => setTimeout(r, 600));
    expect(within(ribbon).getByText(/Selected 0:05\.(49|50) – 0:05\.(70|71)/)).toBeInTheDocument();
    inspectAnswer = { found: false, offset_s: null, code: null, confidence: null };
    mark(300, 400); // 15 s to 20 s: nothing in it
    await waitFor(() =>
      expect(within(ribbon).getByTestId("decode-result")).toHaveTextContent(
        "No registration sound",
      ),
    );
    expect(
      within(ribbon).getByText(/Selected 0:15\.00 – 0:20\.00 \(5\.00 s\)/),
    ).toBeInTheDocument();
  });

  test("the waveform shows only the first two minutes, fitted to the panel's width, and zoom magnifies it", async () => {
    // A recording of an hour, in a ribbon whose waveform box is measured at 480 px.
    const mic = baseMedia.find((m) => m.id === "mic")!;
    const was = mic.duration_s;
    mic.duration_s = 3600;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        cb: () => void;
        constructor(cb: () => void) {
          this.cb = cb;
        }
        observe() {
          this.cb();
        }
        disconnect() {}
      },
    );
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
    try {
      const source = await openSync();
      fireEvent.change(await screen.findByLabelText("Recording"), { target: { value: "mic" } });
      expect(source).toHaveValue("excerpt");
      const ribbon = screen.getByTestId("ribbon");
      const wave = () => ribbon.querySelector(".cursor-crosshair") as HTMLElement;
      // Two minutes (not an hour) across 480 px: it fits, with nothing to scroll.
      await waitFor(() => expect(wave()).toHaveStyle({ width: "480px" }));
      // Put the playhead at 90 s, then zoom: the view is scrolled to keep it in the middle.
      const scrolled: number[] = [];
      Object.defineProperty(wave().parentElement!, "scrollLeft", {
        configurable: true,
        get: () => 0,
        set: (v: number) => scrolled.push(v),
      });
      fireEvent.pointerDown(wave(), { clientX: 360, pointerId: 1 }); // 360 px = 90 s at 4 px/s
      fireEvent.pointerUp(wave(), { clientX: 360, pointerId: 1 });
      fireEvent.click(within(ribbon).getByRole("button", { name: "Zoom in" }));
      expect(wave()).toHaveStyle({ width: "960px" }); // zoom doubles it, to scroll
      expect(scrolled.at(-1)).toBe(720 - 240); // 90 s is now at 720 px; centre it in 480 px
      fireEvent.click(within(ribbon).getByRole("button", { name: "Zoom out" }));
      expect(wave()).toHaveStyle({ width: "480px" });
      expect(within(ribbon).getByRole("button", { name: "Zoom out" })).toBeDisabled(); // not below fit
    } finally {
      mic.duration_s = was;
      width.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  test("with a stretch marked and no playhead, zoom stays centred on the stretch", async () => {
    const mic = baseMedia.find((m) => m.id === "mic")!;
    const was = mic.duration_s;
    mic.duration_s = 3600;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        cb: () => void;
        constructor(cb: () => void) {
          this.cb = cb;
        }
        observe() {
          this.cb();
        }
        disconnect() {}
      },
    );
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
    try {
      await openSync();
      fireEvent.change(await screen.findByLabelText("Recording"), { target: { value: "mic" } });
      const ribbon = screen.getByTestId("ribbon");
      const wave = ribbon.querySelector(".cursor-crosshair") as HTMLElement;
      await waitFor(() => expect(wave).toHaveStyle({ width: "480px" }));
      const scrolled: number[] = [];
      Object.defineProperty(wave.parentElement!, "scrollLeft", {
        configurable: true,
        get: () => 0,
        set: (v: number) => scrolled.push(v),
      });
      fireEvent.pointerDown(wave, { clientX: 200, pointerId: 1 }); // 50 s to 60 s at 4 px/s
      fireEvent.pointerMove(wave, { clientX: 240, pointerId: 1 });
      fireEvent.pointerUp(wave, { clientX: 240, pointerId: 1 });
      fireEvent.click(within(ribbon).getByRole("button", { name: "Zoom in" }));
      expect(scrolled.at(-1)).toBe(55 * 8 - 240); // the middle of the stretch, centred
    } finally {
      mic.duration_s = was;
      width.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  test("the play buttons are only for marking a stretch of a recording", async () => {
    const source = await openSync();
    fireEvent.change(source, { target: { value: "seed" } });
    expect(screen.queryByRole("button", { name: "Play the whole recording" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play just the selection" })).toBeNull();
  });

  test("shows how well each file matched", async () => {
    await openSync();
    expect((await screen.findAllByText("0.50")).length).toBe(3);
  });
});

test("mixing a stretch of one track: select it, set a level, see it on the track, and save it", async () => {
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  // Nothing selected yet: the track, the slider and Mute are all off.
  expect(screen.getByRole("combobox", { name: "Mix track" })).toBeDisabled();
  expect(screen.getByRole("slider", { name: /Level over the selection/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Mute" })).toBeDisabled();

  // Drag across the timeline: in jsdom the lanes start at x=0 and run at 20 px per second.
  const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
  fireEvent.pointerDown(lanes, { clientX: 200, pointerId: 1 });
  fireEvent.pointerMove(lanes, { clientX: 400, pointerId: 1 });
  fireEvent.pointerUp(lanes, { clientX: 400, pointerId: 1 });

  expect(screen.getByRole("combobox", { name: "Mix track" })).toBeEnabled();
  const slider = screen.getByRole("slider", { name: /Level over the selection/ });
  expect(slider).toHaveValue("0"); // nothing is set over this stretch yet
  fireEvent.change(slider, { target: { value: "-8" } }); // letting go of the slider sets the level
  expect(within(timeline).getByText("-8 dB")).toBeInTheDocument(); // drawn on the mic's row
  expect(slider).toHaveValue("-8"); // and the slider reads what the stretch is set to

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
  // The same button now unmutes: back to the track's own level over the stretch.
  fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
  expect(within(timeline).queryByText("muted")).toBeNull();
  expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
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

describe("what survives a reload", () => {
  test("the tab, the playhead and the pick come back; the selection too", async () => {
    savedEdit = { ...baseEdit, switches: [{ at_s: 10, media_id: "camB" }] };
    localStorage.setItem(
      "edith.ui.show",
      JSON.stringify({ tab: "export", t: 12.5, picked: { kind: "segment", index: 0 } }),
    );
    const first = render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByText("0:12.50")).toBeInTheDocument());
    first.unmount();

    localStorage.setItem("edith.ui.show", JSON.stringify({ t: 3, selection: [5, 8] }));
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    await waitFor(() => expect(screen.getByText("0:03.00")).toBeInTheDocument());
    expect(await screen.findByText("0:05.00–0:08.00")).toBeInTheDocument();
  });

  test("a click on another tab is remembered; stale values are ignored", async () => {
    localStorage.setItem(
      "edith.ui.show",
      JSON.stringify({ t: 99999, selection: [3, 99999], picked: { kind: "cut", index: 7 } }),
    );
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    await waitFor(() => expect(screen.getByText("0:00.00")).toBeInTheDocument()); // not past the end
    fireEvent.click(screen.getByRole("tab", { name: /^Sync/ }));
    expect(JSON.parse(localStorage.getItem("edith.ui.show") ?? "{}").tab).toBe("sync");
  });
});

test("channels share one palette on the grid tiles and on the timeline rows", async () => {
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  const tiles = await screen.findByTestId("channel-tiles");
  const chipOf = (tile: HTMLElement) => tile.querySelector("span.top-1") as HTMLElement; // the number chip
  const tileCamera = await within(tiles).findByRole("button", {
    name: "Preview of camera 2: switch to it",
  });
  const tileStill = within(tiles).getByRole("button", { name: "Preview of still 3: switch to it" });
  const rowCamera = within(timeline).getByRole("button", { name: "Switch to Cam A" });
  const rowStill = within(timeline).getByRole("button", { name: "Switch to car.png" });

  for (const chip of [chipOf(tileCamera), rowCamera]) expect(chip.className).toContain("bg-sky");
  for (const chip of [chipOf(tileStill), rowStill]) expect(chip.className).toContain("bg-teal");
  for (const chip of [chipOf(tileCamera), chipOf(tileStill), rowCamera, rowStill]) {
    expect(chip.className).not.toMatch(/neutral|fuchsia|purple|violet/);
  }
});

test("the Edit tab no longer has its own channel buttons: the grid and the number keys do that job", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).queryByRole("button", { name: /^Switch to (camera|still)/ })).toBeNull();
  expect(panel).not.toHaveTextContent(/number keys/i);
  expect(within(panel).getByRole("button", { name: /Cut \(x\)/ })).toBeInTheDocument(); // first group now
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
    const tiles = await screen.findByTestId("channel-tiles");
    // Cam A is on screen (it starts first), so only Cam B (camera 2) is offered. Waiting for its
    // tile also waits for the media to load, which the timeline length depends on.
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced"); // loading is finished; the playhead has been placed
    expect(within(tiles).getAllByRole("button")).toHaveLength(2); // camera 2 and the still
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("0:01.00")).toBeInTheDocument());

    const order = () =>
      [...tiles.children].map(
        (el) => /(?:camera|still) (\d+)/i.exec(el.getAttribute("aria-label") ?? "")?.[1],
      );
    expect(order()).toEqual(["1", "2", "3"]); // camera 1's slot holds the placeholder
    expect(within(tiles).getByTestId("tile-active")).toHaveAttribute(
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
    expect(order()).toEqual(["1", "2", "3"]);
    expect(within(tiles).getByTestId("tile-active")).toHaveAttribute(
      "aria-label",
      "Camera 2 is on screen",
    );

    fireEvent.click(screen.getByRole("button", { name: /Switches \(1\)/ }));
    expect(screen.getByText(/0:01\.0 → Camera 2/)).toBeInTheDocument();
  });

  test("with a range selected, clicking a tile shows it over that range and goes back; Esc clears the selection", async () => {
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("channel-tiles");
    const timeline = screen.getByTestId("timeline");
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced");
    const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
    const select = () => {
      fireEvent.pointerDown(lanes, { clientX: 200, pointerId: 1 });
      fireEvent.pointerMove(lanes, { clientX: 400, pointerId: 1 });
      fireEvent.pointerUp(lanes, { clientX: 400, pointerId: 1 });
    };

    select(); // 0:10 – 0:20
    expect(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    ).toHaveAttribute("title", expect.stringContaining("over 0:10.00 – 0:20.00, then go back"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    ).toHaveAttribute("title", expect.stringContaining("at the playhead"));

    select();
    fireEvent.click(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Switches \(2\)/ }));
    expect(screen.getByText(/0:10\.0 → Camera 2/)).toBeInTheDocument();
    expect(screen.getByText(/0:20\.0 → Camera 1/)).toBeInTheDocument(); // back to what was showing
    expect(screen.getByRole("button", { name: "Cut (x)" })).toBeDisabled(); // selection used up
  });

  test("select a segment on the timeline and delete it: the one before carries on; Esc deselects", async () => {
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("channel-tiles");
    const timeline = screen.getByTestId("timeline");
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("0:01.00")).toBeInTheDocument());
    fireEvent.click(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    );
    expect(screen.getByRole("button", { name: /Switches \(1\)/ })).toBeInTheDocument();

    const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
    const pick = (el: HTMLElement) => {
      fireEvent.pointerDown(el, { clientX: 30, pointerId: 1 });
      fireEvent.pointerUp(lanes, { clientX: 30, pointerId: 1 });
    };
    const segments = () => within(timeline).getAllByTestId("segment");
    pick(segments()[1]); // camera 2's segment (camera 1 has the opening one)
    expect(segments()[1]).toHaveAttribute("aria-selected", "true");
    expect(
      within(timeline).getAllByRole("separator", { name: /of the segment/ }).length,
    ).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(segments()[1]).toHaveAttribute("aria-selected", "false");

    pick(segments()[1]);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.getByRole("button", { name: /Switches \(0\)/ })).toBeInTheDocument();
    expect(within(tiles).getByTestId("tile-active")).toHaveAttribute(
      "aria-label",
      "Camera 1 is on screen", // the previously active segment continues
    );
  });

  test("dragging across the timeline selects a span and deselects a picked segment", async () => {
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("channel-tiles");
    const timeline = screen.getByTestId("timeline");
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("0:01.00")).toBeInTheDocument());
    fireEvent.click(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    );
    const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
    const seg = () => within(timeline).getAllByTestId("segment")[1];
    fireEvent.pointerDown(seg(), { clientX: 30, pointerId: 1 });
    fireEvent.pointerUp(lanes, { clientX: 30, pointerId: 1 });
    expect(seg()).toHaveAttribute("aria-selected", "true");

    fireEvent.pointerDown(lanes, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(lanes, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(lanes, { clientX: 160, pointerId: 1 });
    expect(seg()).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: /Cut \(x\)/ })).toBeEnabled(); // a span is selected
  });

  test("dragging the boundary between two videos compares them side by side and hides the grid", async () => {
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("channel-tiles");
    const timeline = screen.getByTestId("timeline");
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("0:01.00")).toBeInTheDocument());
    fireEvent.click(
      within(tiles).getByRole("button", { name: "Preview of camera 2: switch to it" }),
    ); // camera 2 from 1.0 s on

    const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
    const seg = within(timeline).getAllByTestId("segment")[1]; // camera 2's
    fireEvent.pointerDown(seg, { clientX: 30, pointerId: 1 });
    fireEvent.pointerUp(lanes, { clientX: 30, pointerId: 1 });

    const handle = within(timeline).getByRole("separator", {
      name: "Drag the start of the segment",
    });
    fireEvent.pointerDown(handle, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 40, pointerId: 1 }); // to 2.0 s
    expect(screen.queryByTestId("channel-tiles")).toBeNull(); // the grid steps aside
    expect(screen.getAllByTestId("compare-label").map((l) => l.textContent)).toEqual([
      "Cam A · last frame",
      "Cam B · first frame",
    ]);
    expect(screen.getAllByText("0:02.00").length).toBeGreaterThan(0); // the playhead is on the boundary

    fireEvent.pointerUp(handle, { clientX: 40, pointerId: 1 });
    expect(screen.queryByTestId("compare-label")).toBeNull();
    expect(await screen.findByTestId("channel-tiles")).toBeInTheDocument(); // and comes back
    fireEvent.click(screen.getByRole("button", { name: /Switches \(1\)/ }));
    expect(screen.getByText(/0:02\.0 → Camera 2/)).toBeInTheDocument(); // the edge was committed
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
    expect(screen.getByTestId("channel-tiles").contains(play)).toBe(false);
  });
});

describe("enabling and disabling assets in the Media tab", () => {
  test("a disabled camera leaves the grid, the numbers close up, and it is saved; enabling restores it", async () => {
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("channel-tiles");
    const timeline = screen.getByTestId("timeline");
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced"); // loading finished

    fireEvent.click(screen.getByRole("tab", { name: /Media/ }));
    const toggle = await screen.findByRole("checkbox", { name: "Show Cam B in the grid" });
    expect(toggle).toBeChecked();
    // An audio file has a single control: whether its sound is in the output.
    expect(screen.getByRole("checkbox", { name: "Use audio from mic.wav" })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("unsaved changes")).toBeInTheDocument();
    // Cam B has no slot any more, and the still moved up into number 2.
    expect(within(tiles).queryByRole("button", { name: /camera 2/ })).toBeNull();
    expect(
      within(tiles).getByRole("button", { name: "Preview of still 2: switch to it" }),
    ).toBeInTheDocument();
    // Nothing in the edit shows Cam B, so a disabled Cam B is off the timeline too.
    expect(within(timeline).queryByText("Cam B")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { disabled: string[] }).disabled).toEqual(["camB"]);

    fireEvent.click(toggle); // enable it again
    expect(toggle).toBeChecked();
    expect(
      await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" }),
    ).toBeInTheDocument();
    expect(
      within(tiles).getByRole("button", { name: "Preview of still 3: switch to it" }),
    ).toBeInTheDocument();
  });

  test("the number keys follow the grid: a disabled camera's number goes to the next channel", async () => {
    render(<Workspace slug="show" />);
    await screen.findByText("synced");
    fireEvent.click(screen.getByRole("tab", { name: /Media/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Show Cam B in the grid" }));
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    fireEvent.keyDown(window, { key: "2" }); // now the still, since Cam B is off
    fireEvent.click(await screen.findByRole("button", { name: /Switches \(1\)/ }));
    expect(screen.getByText(/→ Still 2 · car\.png/)).toBeInTheDocument();
  });
});

/** Click a media card (not one of its buttons) to show its details. */
const openDetails = async (name: string) => {
  const card = (await screen.findAllByTestId("media-card")).find((c) =>
    within(c).queryByText(name),
  )!;
  fireEvent.click(within(card).getByText(name));
};

describe("the media cards", () => {
  const found = (patch: Record<string, unknown>) => ({
    ...baseMedia[0],
    id: "newcam",
    path: "show/day 1/cam C/c.mp4",
    label: "c.mp4",
    included: false,
    proxy_ready: false,
    folder: "day 1/cam C",
    ...patch,
  });

  test("every file of the project folder is a card in one grid; the Folder drop-down narrows it, and new ones say so", async () => {
    media = [...baseMedia, found({})];
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const folder = await screen.findByRole("combobox", { name: "Folder" });
    expect([...(folder as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      "All folders",
      "day 1",
      "day 1 / cam C",
    ]);
    expect(await screen.findAllByTestId("media-card")).toHaveLength(5); // no folder headers
    fireEvent.change(folder, { target: { value: "day 1" } }); // a folder lists what is below it too
    const cards = screen.getAllByTestId("media-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute("data-included", "false");
    expect(within(cards[0]).getByText("new")).toBeInTheDocument();
    expect(within(cards[0]).getByText("c.mp4")).toBeInTheDocument();
    // The Media tab says how many are waiting, and only included media count as the project's.
    expect(screen.getByRole("tab", { name: /Media \(4\)/ })).toHaveTextContent("1 new");
  });

  test("found files are not part of the editor until included, and including is the write", async () => {
    media = [...baseMedia, found({})];
    render(<Workspace slug="show" />);
    const tiles = await screen.findByTestId("channel-tiles");
    await within(tiles).findByRole("button", { name: "Preview of camera 2: switch to it" });
    expect(within(tiles).queryByText("c.mp4")).toBeNull(); // not in the grid
    expect(within(screen.getByTestId("timeline")).queryByText("c.mp4")).toBeNull();
    expect(mediaPosts).toEqual([]); // looking wrote nothing

    fireEvent.click(screen.getByRole("tab", { name: /Media/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Include c.mp4 in the project" }));
    await waitFor(() => expect(mediaPosts).toEqual([{ path: "show/day 1/cam C/c.mp4" }]));
    // Included now: it takes part (the grid has a tile for it).
    expect(await within(tiles).findByLabelText(/camera 3/i)).toBeInTheDocument();
  });

  test("clicking a card shows its details in a panel beside the cards; clicking it again hides them", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const card = (await screen.findAllByTestId("media-card")).find((c) =>
      within(c).queryByText("Cam B"),
    )!;
    expect(screen.queryByRole("region", { name: /Details for/ })).toBeNull();
    fireEvent.click(within(card).getByText("Cam B")); // the card itself, not one of its buttons
    expect(await screen.findByRole("region", { name: "Details for Cam B" })).toBeInTheDocument();
    expect(card).toHaveClass("ring-sky-400"); // the selected one is marked
    fireEvent.click(within(card).getByText("Cam B"));
    expect(screen.queryByRole("region", { name: /Details for/ })).toBeNull();
    // Another card replaces it; Close hides it.
    await openDetails("Cam A");
    expect(await screen.findByRole("region", { name: "Details for Cam A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: /Details for/ })).toBeNull();
  });

  test("the details show the path from the project folder's name, and copy the full path", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    await openDetails("Cam A");
    const panel = await screen.findByRole("region", { name: "Details for Cam A" });
    expect(within(panel).getByText(/^show\//)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Copy the full path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toMatch(/^\/Volumes\/SSD\/show\//);
    vi.unstubAllGlobals();
  });

  test("the details' status says whether the file is on, switched off, or not in the project yet", async () => {
    media = [
      ...baseMedia,
      { ...baseMedia[1], id: "camC", label: "Cam C", path: "show/c2.mp4" },
      found({}),
    ];
    savedEdit = {
      ...baseEdit,
      disabled: ["camB"],
      switches: [{ at_s: 0, media_id: "camA" }], // camA shows from the start
    };
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const status = async (name: string) => {
      await openDetails(name);
      const panel = await screen.findByRole("region", { name: `Details for ${name}` });
      return within(panel).getByText("Status").nextElementSibling?.textContent;
    };
    expect(await status("Cam A")).toMatch(/^included, used/); // the opening camera
    expect(await status("Cam B")).toMatch(/^excluded/);
    expect(await status("Cam C")).toMatch(/^included, not used/); // no segment shows it
    expect(await status("c.mp4")).toMatch(/^not included yet/);
  });

  test("the details panel shows the technical details of a file", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    await openDetails("Cam A");
    const dialog = await screen.findByRole("region", { name: "Details for Cam A" });
    expect(await within(dialog).findByText("3840×2160")).toBeInTheDocument();
    expect(within(dialog).getByText("h264 · High")).toBeInTheDocument();
    expect(within(dialog).getByText("8-bit · yuv420p · bt709 · tv")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: /Details for/ })).toBeNull());
  });

  test("a file that is missing says so on its card", async () => {
    media = [{ ...baseMedia[0], missing: true }, ...baseMedia.slice(1)];
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    expect(await screen.findByText("Can't read this file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Relink…" })).toBeInTheDocument(); // nothing found
  });

  test("a file that turned up with the missing one's name and length is offered, and relinking keeps the edit's references", async () => {
    media = [
      { ...baseMedia[0], missing: true },
      ...baseMedia.slice(1),
      found({ id: "camA2", path: "show/a.mp4", label: "Cam A", duration_s: 60, folder: "" }),
    ];
    savedEdit = { ...baseEdit, switches: [{ at_s: 10, media_id: "camA" }] };
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use found file" }));
    await waitFor(() => expect(relinks).toEqual([{ from: "camA", path: "show/a.mp4" }]));
    // The edit now points at the new id, though nothing was saved or changed by hand.
    expect(screen.queryByText("unsaved changes")).toBeNull();
    // Make a change and save: the saved edit names the new id, never the old one.
    const tiles = await screen.findByTestId("channel-tiles");
    fireEvent.click(await within(tiles).findByRole("button", { name: /Preview of camera 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const ids = (puts[0] as { switches: { media_id: string | null }[] }).switches.map(
      (sw) => sw.media_id,
    );
    expect(ids).toContain("camA2");
    expect(ids).not.toContain("camA");
  });

  test("new files turn up by themselves: the media list is checked again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Workspace slug="show" />);
      fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
      await screen.findAllByTestId("media-card");
      expect(screen.queryByText("c.mp4")).toBeNull();
      media = [...baseMedia, found({})]; // someone drops a file into the folder
      await vi.advanceTimersByTimeAsync(5500);
      expect(await screen.findByText("c.mp4")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("filter the cards by kind, new files, or what is not synced yet", async () => {
    media = [...baseMedia, found({})];
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    await screen.findByText("synced"); // the sync results have loaded
    const filter = await screen.findByRole("combobox", { name: "Show" });
    const labels = () =>
      screen
        .getAllByTestId("media-card")
        .map((c) => within(c).getByTitle(/\.(mp4|wav|png)/).textContent);
    expect(labels()).toHaveLength(5);
    fireEvent.change(filter, { target: { value: "new" } });
    expect(labels()).toEqual(["c.mp4"]);
    fireEvent.change(filter, { target: { value: "audio" } });
    expect(labels()).toEqual(["mic.wav"]);
    fireEvent.change(filter, { target: { value: "image" } });
    expect(labels()).toEqual(["car.png"]);
    // Every file in the project is synced in these fixtures, and new files are not in the project.
    fireEvent.change(filter, { target: { value: "unsynced" } });
    expect(await screen.findByText("Nothing matches this filter.")).toBeInTheDocument();
  });

  test("Add all includes the new files that are listed, and switches on what is hidden", async () => {
    media = [
      ...baseMedia,
      found({ id: "n1", path: "show/b/1.mp4", label: "1.mp4", folder: "b" }),
      found({ id: "n2", path: "show/b/2.mp4", label: "2.mp4", folder: "b" }),
      found({ id: "n3", path: "show/c/3.mp4", label: "3.mp4", folder: "c" }),
    ];
    savedEdit = {
      ...baseEdit,
      disabled: ["camB"],
      switches: [{ at_s: 0, media_id: "camA" }], // camA shows from the start
    };
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Folder" }), {
      target: { value: "b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add all" })); // only what is listed
    await waitFor(() =>
      expect(mediaPosts.map((p) => p.path)).toEqual(["show/b/1.mp4", "show/b/2.mp4"]),
    );
    // Cam B is hidden but not listed here, so it stays hidden: nothing to save.
    expect(screen.queryByText("unsaved changes")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Folder" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    expect(await screen.findByText("unsaved changes")).toBeInTheDocument(); // Cam B is on again
  });

  test("Exclude unused switches off the cameras no segment shows; Add all brings them back", async () => {
    media = [...baseMedia, { ...baseMedia[1], id: "camC", label: "Cam C", path: "show/c.mp4" }];
    savedEdit = { ...baseEdit, switches: [{ at_s: 10, media_id: "camB" }] };
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const showAll = await screen.findByRole("button", { name: "Add all" });
    const excludeUnused = screen.getByRole("button", { name: "Exclude unused" });
    expect(showAll).toBeDisabled(); // nothing is hidden yet
    expect(excludeUnused).toBeEnabled(); // Cam C has no segment
    fireEvent.click(excludeUnused);
    expect(screen.getByText("unsaved changes")).toBeInTheDocument();
    expect(excludeUnused).toBeDisabled(); // and nothing else is unused
    expect(showAll).toBeEnabled();
    fireEvent.click(showAll);
    expect(excludeUnused).toBeEnabled(); // Cam C is back, still unused
    expect(showAll).toBeDisabled();
  });

  test("a frame rate that differs from the project's is flagged on the card, and clicking the flag opens the details", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    // The project is 29.97 fps: Cam A (59.94) is flagged, Cam B (29.97) is not.
    const cardOf = (name: string) =>
      screen.getAllByTestId("media-card").find((c) => within(c).queryByText(name))!;
    const flag = within(cardOf("Cam A")).getByRole("button", {
      name: /59.94 fps, but the project is 29.97/,
    });
    expect(within(cardOf("Cam B")).queryByRole("button", { name: /fps, but/ })).toBeNull();
    // Clicking it opens the details, where the same frame rate is marked.
    fireEvent.click(flag);
    const dialog = await screen.findByRole("region", { name: "Details for Cam A" });
    expect(await within(dialog).findByText(/59.94 fps/)).toBeInTheDocument();
  });

  test("the details say how many segments of the edit show a camera", async () => {
    savedEdit = { ...baseEdit, switches: [{ at_s: 10, media_id: "camB" }] };
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    await openDetails("Cam B");
    const dialog = await screen.findByRole("region", { name: "Details for Cam B" });
    expect(within(dialog).getByText(/included, used \(in 1 segment\)/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await openDetails("mic.wav");
    expect(await screen.findByRole("region", { name: "Details for mic.wav" })).toBeInTheDocument();
  });

  test("there is no Add media and no Remove from project: the folder is the way in and out", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    await screen.findAllByTestId("media-card");
    expect(screen.queryByRole("button", { name: /Add media/ })).toBeNull();
    await openDetails("Cam A");
    await screen.findByRole("region", { name: "Details for Cam A" });
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  test("a missing file with no obvious match can be relinked to another file of the folder", async () => {
    media = [
      { ...baseMedia[0], missing: true },
      ...baseMedia.slice(1),
      found({
        id: "other",
        path: "renamed/clip.mp4",
        label: "clip.mp4",
        duration_s: 5,
        folder: "renamed",
      }),
    ];
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Relink…" }));
    const dialog = await screen.findByRole("dialog", { name: "Relink Cam A" });
    fireEvent.click(within(dialog).getByRole("button", { name: "renamed/clip.mp4" }));
    await waitFor(() => expect(relinks).toEqual([{ from: "camA", path: "renamed/clip.mp4" }]));
  });

  test("an audio file can be made the registration sound from its details", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    await openDetails("mic.wav");
    fireEvent.click(await screen.findByRole("button", { name: "Use as the registration sound" }));
    await waitFor(() => expect(syncPosts).toHaveLength(1));
    expect(syncPosts[0].template).toEqual({ kind: "file", path: "m/mic.wav" });
    // Cameras have no such action.
    await openDetails("Cam A");
    await screen.findByRole("region", { name: "Details for Cam A" });
    expect(screen.queryByRole("button", { name: "Use as the registration sound" })).toBeNull();
  });

  test("cameras, stills and audio are told apart by an icon and a tint on the name chip", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const chip = (name: string) =>
      within(
        screen.getAllByTestId("media-card").find((c) => within(c).queryByText(name))!,
      ).getByTestId("name-chip");
    for (const [name, kind, icon, tint] of [
      ["Cam A", "Camera", "video-camera", "bg-sky-950"],
      ["car.png", "Still", "picture", "bg-teal-950"],
      ["mic.wav", "Audio", "sound", "bg-neutral-900"],
    ]) {
      expect(chip(name).title).toMatch(new RegExp(`^${kind}: `));
      expect(chip(name).querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
      expect(chip(name).className).toContain(tint);
    }
  });

  test("a camera whose own audio is out of the output shows the muted speaker", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const camA = () =>
      screen.getAllByTestId("media-card").find((c) => within(c).queryByText("Cam A"))!;
    expect(camA().querySelector('[data-icon="speaker-muted"]')).not.toBeNull(); // off by default
    fireEvent.click(within(camA()).getByLabelText("Use audio from Cam A"));
    expect(camA().querySelector('[data-icon="speaker-muted"]')).toBeNull();
    expect(camA().querySelector('[data-icon="speaker"]')).not.toBeNull();
  });

  test("the Sync tab shows its state as an icon, with the words for screen readers", async () => {
    render(<Workspace slug="show" />);
    const tab = await screen.findByRole("tab", { name: /Sync/ });
    await within(tab).findByTitle("Every file is synced");
    expect(within(tab).getByText("synced")).toHaveClass("sr-only");
    expect(tab.querySelector('[data-icon="check-circle"]')).not.toBeNull();
  });

  test("the sync state on a card is an icon chip the size of the other overlays", async () => {
    render(<Workspace slug="show" />);
    fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
    const card = (await screen.findAllByTestId("media-card")).find((c) =>
      within(c).queryByText("Cam A"),
    )!;
    const chip = within(card).getByRole("img", { name: "Sync: synced" });
    expect(chip.querySelector('[data-icon="check-circle"]')).not.toBeNull();
    expect(chip.className).toContain("h-[18px] w-[18px]"); // the same square as the info and checkbox chips
    expect(chip.className).toContain("text-emerald");
  });
});

test("the header shows where the project lives, and opening it notes it as recent", async () => {
  const touched: string[] = [];
  const before = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/opened")) touched.push(url);
      return (before as typeof fetch)(url, init);
    }),
  );
  render(<Workspace slug="show" />);
  expect(await screen.findByTitle("/Volumes/SSD/show")).toHaveTextContent("/Volumes/SSD/show");
  expect(touched).toEqual(["/api/projects/show/opened"]);
});

test("previews are made on their own: the media tab shows progress, and there is no Build proxies", async () => {
  media = baseMedia.map((m, i) =>
    i === 0 ? { ...m, proxy_ready: false, proxy_building: true } : m,
  );
  render(<Workspace slug="show" />);
  fireEvent.click(await screen.findByRole("tab", { name: /Media/ }));
  expect(await screen.findByTestId("preparing")).toHaveTextContent("Previews (1)");
  expect(screen.queryByRole("button", { name: /Build proxies/ })).toBeNull();
  const card = screen.getAllByTestId("media-card").find((c) => within(c).queryByText("Cam A"))!;
  expect(within(card).getByTitle("Preparing the preview…")).toBeInTheDocument();
  // A file whose preview couldn't be made says so instead of spinning forever.
  expect(card.querySelector('[data-icon="thunderbolt"]')).toBeNull();
});

test("a camera whose file can't be read is flagged on its grid tile; the flag takes you to the Media tab", async () => {
  media = media.map((m) => (m.id === "camB" ? { ...m, missing: true } : m));
  render(<Workspace slug="show" />);
  const tiles = await screen.findByTestId("channel-tiles");
  const flag = await within(tiles).findByRole("img", { name: "Cam B can't be read" });
  fireEvent.click(flag);
  expect(screen.getByRole("tab", { name: /Media/ })).toHaveAttribute("aria-selected", "true");
  // And there the card says the same, with the way out.
  expect(await screen.findByText("Can't read this file")).toBeInTheDocument();
});

describe("the selection's handles", () => {
  const selectSpan = (from: number, to: number) => {
    const lanes = screen.getByTestId("timeline").querySelector(".cursor-crosshair") as HTMLElement;
    fireEvent.pointerDown(lanes, { clientX: from, pointerId: 1 });
    fireEvent.pointerMove(lanes, { clientX: to, pointerId: 1 });
    fireEvent.pointerUp(lanes, { clientX: to, pointerId: 1 });
  };

  test("a selected handle is nudged by the arrow keys (0.1 s, 1 s with shift), not the playhead", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    selectSpan(200, 400); // 0:10 – 0:20
    const handle = within(screen.getByTestId("timeline")).getByRole("separator", {
      name: "Selection start",
    });
    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(screen.getByText("0:11.00–0:20.00")).toBeInTheDocument(); // 10 + 1 + 0.1 - 0.1
  });

  test("the arrows move the playhead by 1 s, Cmd 10 s, Option 0.1 s, Ctrl one frame", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    await screen.findByRole("button", { name: "Preview of camera 2: switch to it" });
    await screen.findByText("synced");
    const press = (init: object, key = "ArrowRight") => fireEvent.keyDown(window, { key, ...init });
    const at = (text: string) => waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
    press({});
    await at("0:01.00");
    press({ metaKey: true });
    await at("0:11.00");
    press({ altKey: true }, "ArrowLeft");
    await at("0:10.90");
    press({ ctrlKey: true }); // 1001/30000 s = 33.4 ms
    await at("0:10.93");
  });

  test("selecting a handle puts the playhead on that edge", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    selectSpan(200, 400); // 0:10 – 0:20
    const timeline = screen.getByTestId("timeline");
    const handle = within(timeline).getByRole("separator", { name: "Selection end" });
    fireEvent.pointerDown(handle, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });
    expect(screen.getByTestId("playhead")).toHaveStyle({ left: "400px" }); // 0:20 at 20 px/s
  });

  test("Esc lets go of a handle first, then of the selection; clicking away clears it", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    selectSpan(200, 400);
    const timeline = screen.getByTestId("timeline");
    fireEvent.pointerDown(within(timeline).getByRole("separator", { name: "Selection end" }), {
      clientX: 400,
      pointerId: 1,
    });
    fireEvent.pointerUp(within(timeline).getByRole("separator", { name: "Selection end" }), {
      clientX: 400,
      pointerId: 1,
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(timeline).getByRole("separator", { name: "Selection end" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByText("0:10.00–0:20.00")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(within(timeline).queryByRole("separator", { name: /Selection/ })).toBeNull();
  });

  test("there are no In/Out buttons or i/o keys: a selection is made by dragging", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    expect(screen.queryByRole("button", { name: /Range (in|out)|Keep only/ })).toBeNull();
    fireEvent.keyDown(window, { key: "i" });
    fireEvent.keyDown(window, { key: "o" });
    expect(
      within(screen.getByTestId("timeline")).queryByRole("separator", { name: /Selection/ }),
    ).toBeNull();
  });

  test("Uncut gives back a stretch of a cut block, splitting the block; it is off when nothing is cut there", async () => {
    render(<Workspace slug="show" />);
    await screen.findByTestId("timeline");
    selectSpan(200, 400);
    fireEvent.click(screen.getByRole("button", { name: "Cut (x)" })); // cut 0:10 – 0:20
    selectSpan(500, 600); // 0:25 – 0:30, nothing cut there
    expect(screen.getByRole("button", { name: "Uncut" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cut (x)" })).toBeEnabled();
    selectSpan(240, 360); // 0:12 – 0:18, wholly inside the cut: nothing left to cut
    expect(screen.getByRole("button", { name: "Cut (x)" })).toBeDisabled();
    selectSpan(280, 320); // 0:14 – 0:16, inside the cut
    fireEvent.click(screen.getByRole("button", { name: "Uncut" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as EditList).cuts).toEqual([
      { start_s: 10, end_s: 14 },
      { start_s: 16, end_s: 20 },
    ]);
  });
});

describe("a picked audio level", () => {
  const level = { media_id: "mic", start_s: 10, end_s: 20, gain_db: -6, muted: false };

  test("is picked by clicking it: the panel shows and changes its level, Delete removes it", async () => {
    savedEdit = { ...baseEdit, mix: [level] };
    render(<Workspace slug="show" />);
    const timeline = await screen.findByTestId("timeline");
    fireEvent.pointerDown(screen.getByTestId("mix-region"), { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId("mix-region"), { clientX: 300, pointerId: 1 });
    // The panel now works on that stretch: its title is its span, the track is fixed.
    expect(screen.getByText("0:10.00–0:20.00")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: /Level over the selection/ });
    expect(slider).toBeEnabled();
    expect(slider).toHaveValue("-6");
    expect(screen.getByRole("combobox", { name: "Mix track" })).toBeDisabled();
    fireEvent.change(slider, { target: { value: "3" } });
    expect(within(timeline).getByText("+3 dB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(within(timeline).getByText("muted")).toBeInTheDocument();
    // Delete takes the whole level away (the track goes back to its own gain there).
    fireEvent.keyDown(window, { key: "Delete" });
    expect(screen.queryByTestId("mix-region")).toBeNull();
  });
});

test("the level slider starts at the track's own gain and stores the change from it", async () => {
  savedEdit = { ...baseEdit, tracks: [{ media_id: "mic", gain_db: -6, muted: false }] };
  render(<Workspace slug="show" />);
  const timeline = await screen.findByTestId("timeline");
  const lanes = timeline.querySelector(".cursor-crosshair") as HTMLElement;
  fireEvent.pointerDown(lanes, { clientX: 200, pointerId: 1 });
  fireEvent.pointerMove(lanes, { clientX: 400, pointerId: 1 });
  fireEvent.pointerUp(lanes, { clientX: 400, pointerId: 1 });
  const slider = screen.getByRole("slider", { name: /Level over the selection/ });
  expect(slider).toHaveValue("-6"); // the timeline's gain for this track
  fireEvent.change(slider, { target: { value: "-2" } });
  expect(within(timeline).getByText("-2 dB")).toBeInTheDocument(); // the level it plays at
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0] as { mix: unknown[] }).mix).toEqual([
    { media_id: "mic", start_s: 10, end_s: 20, gain_db: 4, muted: false }, // +4 on top of the track's -6
  ]);
});

test("no icon is used twice among the ribbon's tabs and buttons", async () => {
  render(<Workspace slug="show" />);
  const ribbon = await screen.findByTestId("ribbon");
  await screen.findByTestId("timeline");
  const names: string[] = [];
  const collect = (selector: string) =>
    ribbon.querySelectorAll(selector).forEach((el) => names.push(el.getAttribute("data-icon")!));
  collect('[role="tab"] [data-icon]'); // the tabs' own icons, once
  for (const tab of ["Sync", "Edit", "Export"]) {
    fireEvent.click(within(ribbon).getByRole("tab", { name: new RegExp(tab) }));
    // The panel's buttons and links (the drop-downs' carets are the one icon meant to repeat).
    collect(':scope > :not([role="tablist"]) :is(button, a) [data-icon]:not([data-icon="down"])');
  }
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  expect(twice).toEqual([]);
  expect(names.length).toBeGreaterThan(12); // it did look at the buttons
});

describe("the Project panel", () => {
  const openExport = async () => {
    render(<Workspace slug="show" />);
    const ribbon = await screen.findByTestId("ribbon");
    await screen.findByTestId("timeline");
    fireEvent.click(within(ribbon).getByRole("tab", { name: /Export/ }));
    return ribbon;
  };

  test("shows the project's size, frame rate and output format on the Export tab", async () => {
    const ribbon = await openExport();
    expect(within(ribbon).getByRole("spinbutton", { name: "Width (px)" })).toHaveValue(1920);
    expect(within(ribbon).getByRole("spinbutton", { name: "Height (px)" })).toHaveValue(1080);
    expect(within(ribbon).getByRole("combobox", { name: "Common sizes" })).toHaveValue("1920x1080");
    expect(within(ribbon).getByRole("combobox", { name: "Frame rate" })).toHaveValue("30000/1001");
    expect(within(ribbon).getByRole("combobox", { name: "Output format" })).toHaveValue("h264");
  });

  test("any size can be typed (kept even), and the picker then says Custom", async () => {
    const ribbon = await openExport();
    fireEvent.change(within(ribbon).getByRole("spinbutton", { name: "Width (px)" }), {
      target: { value: "1601" },
    });
    fireEvent.change(within(ribbon).getByRole("spinbutton", { name: "Height (px)" }), {
      target: { value: "900" },
    });
    expect(within(ribbon).getByRole("combobox", { name: "Common sizes" })).toHaveValue("custom");
    expect(within(ribbon).getByRole("button", { name: "Render MP4 (900p)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ width: 1602, height: 900 });
  });

  test("the picker sets both sides; the frame rate and output format are saved with the edit", async () => {
    const ribbon = await openExport();
    fireEvent.change(within(ribbon).getByRole("combobox", { name: "Common sizes" }), {
      target: { value: "3840x2160" },
    });
    fireEvent.change(within(ribbon).getByRole("combobox", { name: "Frame rate" }), {
      target: { value: "25/1" },
    });
    fireEvent.change(within(ribbon).getByRole("combobox", { name: "Output format" }), {
      target: { value: "prores" },
    });
    expect(within(ribbon).getByRole("button", { name: "Render MOV (2160p)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      width: 3840,
      height: 2160,
      fps_num: 25,
      fps_den: 1,
      encoding: "prores",
    });
  });

  test("warns about a too-small file only when the export uses it", async () => {
    // car.png is 100×50: far smaller than 1920×1080.
    let ribbon = await openExport();
    expect(within(ribbon).queryByTestId("scaled-up-warning")).toBeNull(); // nothing shows it
    cleanup();
    savedEdit = { ...baseEdit, switches: [{ at_s: 10, media_id: "car" }] };
    ribbon = await openExport();
    expect(within(ribbon).getByTestId("scaled-up-warning")).toHaveAttribute(
      "title",
      expect.stringContaining("car.png"),
    );
    cleanup();
    // ...but not when the part that shows it is cut out.
    savedEdit = {
      ...baseEdit,
      switches: [
        { at_s: 10, media_id: "car" },
        { at_s: 20, media_id: null },
      ],
      cuts: [{ start_s: 10, end_s: 20 }],
    };
    ribbon = await openExport();
    expect(within(ribbon).queryByTestId("scaled-up-warning")).toBeNull();
  });
});

test("while rendering, the ribbon shows a compact progress bar in its own cell, not a wide one", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  const ribbon = screen.getByTestId("ribbon");
  fireEvent.click(await screen.findByRole("tab", { name: "Export" }));
  fireEvent.click(await screen.findByRole("button", { name: "Render MP4 (1080p)" }));
  const bar = await within(ribbon).findByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "0");
  expect(bar).toHaveTextContent("0%");
  // It lives on the ribbon grid (two units wide, inset like every control), so it cannot overlap.
  expect(bar).toHaveStyle({ gridColumn: "span 2" });
  expect(bar.className).toContain("m-[2px]");
  expect(bar.className).not.toContain("w-48");
});

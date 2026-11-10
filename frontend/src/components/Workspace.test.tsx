import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";

import { Workspace } from "./Workspace";

const media = [
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
  range_in_s: null,
  range_out_s: null,
  fps_num: 30000,
  fps_den: 1001,
  width: 1920,
  height: 1080,
};

let puts: unknown[] = [];

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  puts = [];
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
      if (path.endsWith("/media")) return respond(media);
      if (path.endsWith("/sync"))
        return respond({
          template: null,
          nudges: {},
          needs_upgrade: false,
          results: { camA: synced(5), camB: synced(10), mic: synced(0) },
        });
      if (path.endsWith("/edit")) return respond({ edit: baseEdit, needs_upgrade: false });
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
  expect(screen.getByLabelText("Mute mic.wav")).toBeInTheDocument();
  expect(await screen.findByText(/Cam B has no footage/)).toBeInTheDocument();
  expect(screen.getByText(/saved by an older version of Edith/)).toBeInTheDocument();
});

test("switching camera marks the edit unsaved; saving sends it and clears the mark", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  expect(screen.queryByText("unsaved changes")).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: "2 · Cam B" }));
  expect(screen.getByText("unsaved changes")).toBeInTheDocument();
  expect(screen.getByText(/→ Cam B/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0] as typeof baseEdit).switches).toEqual([{ at_s: 0, media_id: "camB" }]);
  await waitFor(() => expect(screen.queryByText("unsaved changes")).toBeNull());
});

test("undo reverts a change", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  fireEvent.click(await screen.findByRole("button", { name: "2 · Cam B" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.queryByText("unsaved changes")).toBeNull();
});

test("muting a track and the number keys edit the timeline", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
  fireEvent.click(screen.getByLabelText("Mute mic.wav"));
  expect(screen.getByText("unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect((puts[0] as typeof baseEdit).tracks).toEqual([
    { media_id: "mic", gain_db: 0, muted: true },
  ]);

  fireEvent.keyDown(window, { key: "2" });
  await waitFor(() => expect(screen.getByText(/→ Cam B/)).toBeInTheDocument());
});

test("renders from the export section and lists finished renders", async () => {
  render(<Workspace slug="show" />);
  await screen.findByTestId("timeline");
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

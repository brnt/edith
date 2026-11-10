import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";

import { App } from "./app";

const existing = {
  slug: "pilot",
  name: "Pilot",
  folder: "/Volumes/SSD/pilot",
  created_at: "2026-01-01T00:00:00Z",
  needs_upgrade: true,
  available: true,
  last_opened: "2026-02-01T00:00:00Z",
};
const unplugged = {
  ...existing,
  slug: "gone",
  name: "On a drive",
  folder: "/Volumes/Away/show",
  created_at: null,
  needs_upgrade: false,
  available: false,
};

const folders: Record<string, unknown> = {
  "/Volumes/SSD": {
    dir: "/Volumes/SSD",
    parent: "/Volumes",
    is_project: false,
    entries: [
      { name: "media", path: "/Volumes/SSD/media", is_project: false },
      { name: "pilot", path: "/Volumes/SSD/pilot", is_project: true },
    ],
  },
  "/Volumes/SSD/pilot": {
    dir: "/Volumes/SSD/pilot",
    parent: "/Volumes/SSD",
    is_project: true,
    entries: [],
  },
  "/Volumes/SSD/media": {
    dir: "/Volumes/SSD/media",
    parent: "/Volumes/SSD",
    is_project: false,
    entries: [],
  },
};

function reply(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
  });
}

const fetchMock = vi.fn();
let recent: unknown[] = [];

beforeEach(() => {
  recent = [existing, unplugged];
  window.location.hash = "";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "");
    if (path.startsWith("/fs/places")) return reply([{ name: "SSD", path: "/Volumes/SSD" }]);
    if (path.startsWith("/fs/folders")) {
      const dir = decodeURIComponent(path.split("dir=")[1] ?? "");
      return reply(folders[dir] ?? folders["/Volumes/SSD"]);
    }
    if (init?.method === "DELETE") return reply(null, 204);
    if (init?.method === "POST" && path === "/projects") {
      const body = JSON.parse(init.body as string) as { name: string; folder: string };
      return reply({ ...existing, slug: "new", name: body.name, folder: body.folder }, 201);
    }
    if (init?.method === "POST" && path === "/projects/open") return reply(existing);
    if (path === "/projects") return reply(recent);
    return reply({}, 404);
  });
});

const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([url, init]) => [url.replace(/^\/api/, ""), JSON.parse(init.body)]);

test("the start page lists recent projects with their folders, and flags older formats", async () => {
  render(<App />);
  expect(await screen.findByText("Pilot")).toBeInTheDocument();
  // The folder, with its own name shown separately so long paths can shorten from the left.
  expect(screen.getByTitle("/Volumes/SSD/pilot")).toHaveTextContent("/Volumes/SSD/pilot");
  expect(screen.getByText("older format")).toBeInTheDocument();
});

test("a project whose folder can't be found stays listed, says so, and can be forgotten", async () => {
  render(<App />);
  expect(await screen.findByText("On a drive")).toBeInTheDocument();
  expect(screen.getByText(/Can't find this folder right now/)).toBeInTheDocument();
  // It is not a link (there is nothing to open), but it can be taken off the list.
  expect(screen.queryByRole("link", { name: "On a drive" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Forget On a drive" }));
  await waitFor(() => expect(screen.queryByText("On a drive")).toBeNull());
  const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
  expect(del![0]).toBe("/api/projects/gone/recent");
});

test("a new project goes in the folder you select, named after it unless you say otherwise", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" })); // a place to start from
  fireEvent.click(await within(dialog).findByRole("button", { name: "media" })); // select it
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("will live in “media”");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project here" }));
  await waitFor(() => expect(window.location.hash).toBe("#/p/new"));
  expect(posts()).toEqual([["/projects", { name: "media", folder: "/Volumes/SSD/media" }]]);
});

test("or in the folder you have browsed into, with a name and a new sub-folder if you like", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Go inside media" }));
  await waitFor(() =>
    expect(within(dialog).getByTestId("folder-path")).toHaveTextContent("/Volumes/SSD/media"),
  );
  fireEvent.input(within(dialog).getByLabelText("Project name"), { target: { value: "Ep 1" } });
  fireEvent.input(within(dialog).getByLabelText("New folder name"), {
    target: { value: "Episode 1" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project here" }));
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0][1]).toEqual({ name: "Ep 1", folder: "/Volumes/SSD/media/Episode 1" });
});

test("a folder that already has a project can't be used for a new one", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "pilot .edith" }));
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("already has a project");
  expect(within(dialog).getByRole("button", { name: "Create project here" })).toBeDisabled();
});

test("opening a project: select a folder with a .edith file in it, then Open", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  const open = within(dialog).getByRole("button", { name: "Open this project" });
  expect(open).toBeDisabled(); // /Volumes/SSD itself has no project in it

  // Selecting a folder without one says so, and doesn't enable Open.
  fireEvent.click(await within(dialog).findByRole("button", { name: "media" }));
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent(
    "no .edith project file in “media”",
  );
  expect(open).toBeDisabled();

  // Selecting the one that has a project is all it takes: no need to go inside it.
  fireEvent.click(within(dialog).getByRole("button", { name: "pilot .edith" }));
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent(
    "Open the project in “pilot”",
  );
  await waitFor(() => expect(open).not.toBeDisabled());
  fireEvent.click(open);
  await waitFor(() => expect(window.location.hash).toBe("#/p/pilot"));
  expect(posts()).toEqual([["/projects/open", { folder: "/Volumes/SSD/pilot" }]]);
});

test("double-clicking a folder goes inside it, and so does its arrow", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  fireEvent.dblClick(await within(dialog).findByRole("button", { name: "media" }));
  await waitFor(() =>
    expect(within(dialog).getByTestId("folder-path")).toHaveTextContent("/Volumes/SSD/media"),
  );
  // Inside a folder with a project, with nothing selected, Open acts on that folder.
  fireEvent.click(within(dialog).getByRole("button", { name: "up" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Go inside pilot" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Open this project" })).not.toBeDisabled(),
  );
});

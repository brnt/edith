import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";

import { App } from "./app";

const existing = {
  slug: "pilot",
  name: "Pilot",
  file: "/Volumes/SSD/pilot/project.edith",
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
  file: "/Volumes/Away/show/Cut B.edith",
  folder: "/Volumes/Away/show",
  created_at: null,
  needs_upgrade: false,
  available: false,
};

const entry = (name: string, edith_files = 0) => ({
  name,
  path: `/Volumes/SSD/${name}`,
  edith_files,
  is_project: edith_files > 0,
});
const file = (dir: string, name: string) => ({ name, path: `${dir}/${name}` });

const folders: Record<string, unknown> = {
  "/Volumes/SSD": {
    dir: "/Volumes/SSD",
    parent: "/Volumes",
    is_project: false,
    files: [],
    entries: [entry("media"), entry("pilot", 1), entry("twin", 2)],
  },
  "/Volumes/SSD/pilot": {
    dir: "/Volumes/SSD/pilot",
    parent: "/Volumes/SSD",
    is_project: true,
    files: [file("/Volumes/SSD/pilot", "project.edith")],
    entries: [],
  },
  "/Volumes/SSD/twin": {
    dir: "/Volumes/SSD/twin",
    parent: "/Volumes/SSD",
    is_project: true,
    files: [file("/Volumes/SSD/twin", "Cut A.edith"), file("/Volumes/SSD/twin", "Cut B.edith")],
    entries: [],
  },
  "/Volumes/SSD/media": {
    dir: "/Volumes/SSD/media",
    parent: "/Volumes/SSD",
    is_project: false,
    files: [],
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

test("a new project can go in a folder that already has one: it is saved beside it", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "pilot .edith" }));
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("already has a project");
  expect(within(dialog).getByRole("button", { name: "Create project here" })).toBeEnabled();
});

test("opening a project: select a folder that has one .edith file, then Open", async () => {
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

  // The one with a project is all it takes: no need to go inside it.
  fireEvent.click(within(dialog).getByRole("button", { name: "pilot .edith" }));
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent(
    "Open the project in “pilot”",
  );
  await waitFor(() => expect(open).not.toBeDisabled());
  fireEvent.click(open);
  await waitFor(() => expect(window.location.hash).toBe("#/p/pilot"));
  expect(posts()).toEqual([["/projects/open", { path: "/Volumes/SSD/pilot" }]]);
});

test("a folder with several projects asks you to choose one; naming the file settles it", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  const open = within(dialog).getByRole("button", { name: "Open this project" });

  fireEvent.click(await within(dialog).findByRole("button", { name: "twin .edith" }));
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("has 2 projects");
  expect(open).toBeDisabled(); // which one? not clear from the folder alone

  fireEvent.click(within(dialog).getByRole("button", { name: "Go inside twin" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Cut B.edith" })); // a file
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("Open “Cut B.edith”");
  await waitFor(() => expect(open).not.toBeDisabled());
  fireEvent.click(open);
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()).toEqual([["/projects/open", { path: "/Volumes/SSD/twin/Cut B.edith" }]]);
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
  // Inside a folder with one project, with nothing selected, Open acts on that folder.
  fireEvent.click(within(dialog).getByRole("button", { name: "up" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Go inside pilot" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Open this project" })).not.toBeDisabled(),
  );
});

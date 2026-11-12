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
    media: [],
    media_more: 0,
    entries: [entry("media"), entry("pilot", 1), entry("twin", 2)],
  },
  "/Volumes/SSD/pilot": {
    dir: "/Volumes/SSD/pilot",
    parent: "/Volumes/SSD",
    is_project: true,
    files: [file("/Volumes/SSD/pilot", "project.edith")],
    media: [],
    media_more: 0,
    entries: [],
  },
  "/Volumes/SSD/twin": {
    dir: "/Volumes/SSD/twin",
    parent: "/Volumes/SSD",
    is_project: true,
    files: [file("/Volumes/SSD/twin", "Cut A.edith"), file("/Volumes/SSD/twin", "Cut B.edith")],
    media: [],
    media_more: 0,
    entries: [],
  },
  "/Volumes/SSD/media": {
    dir: "/Volumes/SSD/media",
    parent: "/Volumes/SSD",
    is_project: false,
    files: [],
    media: [],
    media_more: 0,
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
    if (path.startsWith("/fs/places"))
      return reply([
        { name: "Home", path: "/Users/me", kind: "home" },
        { name: "SSD", path: "/Volumes/SSD", kind: "drive" },
      ]);
    if (init?.method === "POST" && path === "/fs/folders") {
      const body = JSON.parse(init.body as string) as { parent: string; name: string };
      if (body.name === "taken")
        return reply(
          { detail: "FolderExists", message: "“taken” already exists in “media”." },
          409,
        );
      const base = folders[body.parent] as { entries: unknown[] };
      const made = {
        name: body.name,
        path: `${body.parent}/${body.name}`,
        edith_files: 0,
        is_project: false,
      };
      return reply({ ...base, dir: body.parent, entries: [...base.entries, made] }, 201);
    }
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

test("a project whose file can't be found is simply not listed, and the rest can be removed", async () => {
  render(<App />);
  expect(await screen.findByText("Pilot")).toBeInTheDocument();
  expect(screen.queryByText("On a drive")).toBeNull(); // no entry, no error message
  expect(screen.queryByText(/Can't find this folder/)).toBeNull();
  // Removing one takes only its list entry, at once and without a dialog.
  const remove = screen.getByRole("button", { name: "Remove Pilot from the list" });
  expect(remove).toHaveTextContent("Remove from list");
  expect(remove).toHaveAttribute("title", expect.stringContaining("stay on disk"));
  fireEvent.click(remove);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  await waitFor(() => expect(screen.queryByText("Pilot")).toBeNull());
  const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
  expect(del![0]).toBe("/api/projects/pilot/recent");
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

test("or in the folder you have browsed into, or one made there with New Folder", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  fireEvent.dblClick(await within(dialog).findByRole("button", { name: "media" }));
  await waitFor(() =>
    expect(within(dialog).getByTestId("folder-path")).toHaveTextContent("/Volumes/SSD/media"),
  );
  // New Folder opens its own dialog and makes the folder in the one being looked at.
  fireEvent.click(within(dialog).getByRole("button", { name: "New Folder" }));
  const naming = await screen.findByRole("dialog", { name: "New folder" });
  fireEvent.input(within(naming).getByLabelText("Folder name"), {
    target: { value: "Episode 1" },
  });
  fireEvent.click(within(naming).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull());
  // The new folder is selected, so that is where the project goes.
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("“Episode 1”");
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project here" }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(posts()[0]).toEqual(["/fs/folders", { parent: "/Volumes/SSD/media", name: "Episode 1" }]);
  expect(posts()[1][1]).toEqual({ name: "Episode 1", folder: "/Volumes/SSD/media/Episode 1" }); // named after its folder
});

test("a folder that already has a project can hold another: its project is listed, and nothing nags", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  const create = within(dialog).getByRole("button", { name: "Create project here" });
  // The folder row carries no .edith marker, and selecting it just says where the project goes.
  const row = await within(dialog).findByRole("button", { name: "pilot" });
  expect(row).not.toHaveTextContent(".edith");
  fireEvent.click(row);
  expect(within(dialog).getByTestId("folder-hint")).toHaveTextContent("will live in “pilot”");
  expect(create).toBeEnabled();
  // Inside, the project that is there is listed (greyed, not selectable), but not in the help text.
  fireEvent.dblClick(row);
  const file = await within(dialog).findByRole("button", { name: "project.edith" });
  expect(file).toHaveAttribute("aria-disabled", "true");
  expect(within(dialog).getByTestId("folder-hint")).not.toHaveTextContent("project.edith");
  expect(create).toBeEnabled();
});

test("opening a project: select a folder that has one .edith file, then Open", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "SSD" }));
  const open = within(dialog).getByRole("button", { name: "Open this project" });
  expect(open).toBeDisabled(); // /Volumes/SSD itself has no project in it

  // Selecting a folder without one just leaves Open off: no warning text.
  fireEvent.click(await within(dialog).findByRole("button", { name: "media" }));
  await waitFor(() => expect(within(dialog).getByTestId("folder-hint").textContent).toBe("")); // no nagging text
  expect(open).toBeDisabled();

  // The one with a project is all it takes: no need to go inside it.
  fireEvent.click(within(dialog).getByRole("button", { name: "pilot" }));
  expect(within(dialog).getByTestId("folder-hint").textContent).toBe(""); // Open says nothing
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

  fireEvent.click(await within(dialog).findByRole("button", { name: "twin" }));
  expect(within(dialog).getByTestId("folder-hint").textContent).toBe(""); // no warning, just no Open
  expect(open).toBeDisabled(); // which one? not clear from the folder alone

  fireEvent.dblClick(within(dialog).getByRole("button", { name: "twin" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Cut B.edith" })); // a file
  expect(within(dialog).getByTestId("folder-hint").textContent).toBe("");
  await waitFor(() => expect(open).not.toBeDisabled());
  fireEvent.click(open);
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()).toEqual([["/projects/open", { path: "/Volumes/SSD/twin/Cut B.edith" }]]);
});

test("double-clicking a folder goes inside it", async () => {
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
  fireEvent.click(
    within(within(dialog).getByRole("navigation", { name: "Places" })).getByRole("button", {
      name: "SSD",
    }),
  );
  fireEvent.dblClick(await within(dialog).findByRole("button", { name: "pilot" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Open this project" })).not.toBeDisabled(),
  );
});

test("the picker is laid out like the Finder: places on the left, a drive drawn as a hard drive", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  const places = within(dialog).getByRole("navigation", { name: "Places" });
  const icon = (name: string) =>
    within(places)
      .getByRole("button", { name })
      .querySelector("[data-icon]")
      ?.getAttribute("data-icon");
  expect(await within(places).findByRole("button", { name: "SSD" })).toBeInTheDocument();
  expect(icon("SSD")).toBe("hdd");
  expect(icon("Home")).toBe("home");
  expect(within(places).queryByText(/Favorites/)).toBeNull(); // no assumptions about what is a favorite
  expect(within(places).getAllByRole("button")).toHaveLength(2); // Home and the one drive
});

test("every folder in the path is a link to that level; Back and Forward retrace", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  fireEvent.dblClick(await within(dialog).findByRole("button", { name: "media" }));
  const path = within(dialog).getByTestId("folder-path");
  await waitFor(() => expect(path).toHaveTextContent("/Volumes/SSD/media"));
  expect(within(path).queryByRole("button", { name: /media/ })).toBeNull(); // where you are: plain
  fireEvent.click(within(path).getByRole("button", { name: "SSD" })); // a higher level
  await waitFor(() => expect(path).toHaveTextContent(/^\/Volumes\/SSD$/));
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  await waitFor(() => expect(path).toHaveTextContent("/Volumes/SSD/media"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Forward" }));
  await waitFor(() => expect(path).toHaveTextContent(/^\/Volumes\/SSD$/));
});

test("New Folder says what is wrong in the dialog and keeps it open", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  await within(dialog).findByRole("button", { name: "media" });
  fireEvent.click(within(dialog).getByRole("button", { name: "New Folder" }));
  const naming = await screen.findByRole("dialog", { name: "New folder" });
  expect(within(naming).getByRole("button", { name: "Create" })).toBeDisabled(); // no name yet
  fireEvent.input(within(naming).getByLabelText("Folder name"), { target: { value: "taken" } });
  fireEvent.click(within(naming).getByRole("button", { name: "Create" }));
  await waitFor(() =>
    expect(within(naming).getByRole("alert")).toHaveTextContent("already exists"),
  );
  expect(screen.getByRole("dialog", { name: "New folder" })).toBeInTheDocument(); // still open
});

test("Esc dismisses the picker, or the New Folder dialog first when that is up", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  await within(dialog).findByRole("button", { name: "media" });
  fireEvent.click(within(dialog).getByRole("button", { name: "New Folder" }));
  await screen.findByRole("dialog", { name: "New folder" });
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull());
  expect(screen.getByRole("dialog")).toBeInTheDocument(); // the picker is still up
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("clicking outside a dialog dismisses it (the New Folder one first)", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  await within(dialog).findByRole("button", { name: "media" });
  fireEvent.click(within(dialog).getByRole("button", { name: "New Folder" }));
  const naming = await screen.findByRole("dialog", { name: "New folder" });
  fireEvent.mouseDown(within(naming).getByLabelText("Folder name")); // inside: nothing happens
  expect(screen.getByRole("dialog", { name: "New folder" })).toBeInTheDocument();
  fireEvent.mouseDown(naming); // its backdrop
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull());
  expect(screen.getByRole("dialog")).toBeInTheDocument(); // the picker is still there
  fireEvent.mouseDown(within(dialog).getByRole("button", { name: "Cancel" })); // inside: nothing
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.mouseDown(dialog); // the picker's backdrop
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("the picker keeps one height however many folders it lists", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  const panel = dialog.firstElementChild as HTMLElement;
  expect(panel.className).toContain("h-[34rem]"); // a fixed height, not content-sized
  expect(panel.className).not.toMatch(/(^|\s)min-h-|max-h-\[85vh\]/);
});

test("the picker lists the media files a folder holds (greyed, not selectable), and counts the rest", async () => {
  const withMedia = {
    ...(folders["/Volumes/SSD/media"] as object),
    media: [
      { name: "A001.MP4", kind: "video" },
      { name: "room.wav", kind: "audio" },
      { name: "still.jpg", kind: "image" },
    ],
    media_more: 12,
  };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url.includes("dir=%2FVolumes%2FSSD%2Fmedia") ? reply(withMedia) : original(url, init),
  );
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  fireEvent.dblClick(await within(dialog).findByRole("button", { name: "media" }));
  const files = await within(dialog).findAllByTestId("media-file");
  expect(files.map((f) => f.textContent)).toEqual(["A001.MP4", "room.wav", "still.jpg"]);
  expect(files.map((f) => f.querySelector("[data-icon]")?.getAttribute("data-icon"))).toEqual([
    "video-camera",
    "sound",
    "picture",
  ]);
  expect(files[0]).toHaveAttribute("aria-disabled", "true");
  expect(within(dialog).getByText(/and 12 more media files/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/empty/)).toBeNull();
});

test("the project's name defaults to the folder's, and can be typed (several projects can share a folder)", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  const name = within(dialog).getByLabelText("Project name");
  fireEvent.click(await within(dialog).findByRole("button", { name: "pilot" })); // already has one
  expect(name).toHaveAttribute("placeholder", "(defaults to the folder's name)");
  fireEvent.input(name, { target: { value: "  Cut B  " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create project here" }));
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0]).toEqual(["/projects", { name: "Cut B", folder: "/Volumes/SSD/pilot" }]);
});

test("Enter in the project name field creates the project, like the button", async () => {
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /New project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "media" }));
  const name = within(dialog).getByLabelText("Project name");
  fireEvent.input(name, { target: { value: "Ep 7" } });
  fireEvent.keyDown(name, { key: "Enter" });
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0]).toEqual(["/projects", { name: "Ep 7", folder: "/Volumes/SSD/media" }]);
  await waitFor(() => expect(window.location.hash).toBe("#/p/new"));
});

test("a file's tooltip in the picker is its path", async () => {
  const withMedia = {
    ...(folders["/Volumes/SSD/pilot"] as object),
    media: [{ name: "A001.MP4", kind: "video" }],
    media_more: 0,
  };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url.includes("dir=%2FVolumes%2FSSD%2Fpilot") ? reply(withMedia) : original(url, init),
  );
  render(<App />);
  await screen.findByText("Pilot");
  fireEvent.click(screen.getByRole("button", { name: /Open project/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "SSD" }));
  fireEvent.dblClick(await within(dialog).findByRole("button", { name: "pilot" }));
  const project = await within(dialog).findByRole("button", { name: "project.edith" });
  expect(project).toHaveAttribute("title", "/Volumes/SSD/pilot/project.edith");
  expect(within(dialog).getByTestId("media-file")).toHaveAttribute(
    "title",
    "/Volumes/SSD/pilot/A001.MP4",
  );
});

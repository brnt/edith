import { useEffect, useState } from "preact/hooks";

import { createProject, fetchProjects, forgetProject, openProject, type Project } from "../lib/api";
import { FolderBrowser } from "./FolderBrowser";
import { FolderPath } from "./FolderPath";
import { Icon } from "./Icon";
import { Badge, Button } from "./ui";
import { Close, Folder, Plus } from "./icons";

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path;

const goTo = (project: Project) => {
  window.location.hash = `#/p/${project.slug}`;
};

function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** The start page: new and open, and the projects you used recently. There is nothing to scan. */
export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [dialog, setDialog] = useState<"new" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  // One whose file can't be found now (a drive unplugged) is simply not shown.
  const load = () =>
    fetchProjects()
      .then((all) => setProjects(all.filter((p) => p.available)))
      .catch(fail);
  useEffect(() => {
    void load();
  }, []);

  // Named as typed, else after its folder (several projects can share one folder).
  const create = (folder: string, name: string) =>
    createProject(name || basename(folder) || "Project", folder).then(goTo, (e: unknown) => {
      setDialog(null);
      fail(e);
    });

  const open = (folder: string) =>
    openProject(folder).then(goTo, (e: unknown) => {
      setDialog(null);
      fail(e);
    });

  const forget = (project: Project) =>
    forgetProject(project.slug).then(
      () => setProjects((current) => current.filter((p) => p.slug !== project.slug)),
      fail,
    );

  return (
    <main class="mx-auto max-w-2xl p-8">
      <h1 class="text-2xl font-bold">Edith</h1>
      <p class="mt-1 text-sm text-neutral-400">
        Sync, cut, and switch cameras for long-form recordings. A project is a folder: put the media
        in it and Edith picks it up.
      </p>
      {error && <p class="mt-2 text-red-400">{error}</p>}
      <div class="mt-4 flex gap-2">
        <Button variant="primary" icon={Plus} onClick={() => setDialog("new")}>
          New project…
        </Button>
        <Button icon={Folder} onClick={() => setDialog("open")}>
          Open project…
        </Button>
      </div>
      <h2 class="mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500">Recent</h2>
      {projects.length === 0 && (
        <p class="mt-2 text-sm text-neutral-500">
          Nothing yet. Create a project in the folder that holds your media, or open one you already
          have.
        </p>
      )}
      <ul class="mt-2 space-y-2">
        {projects.map((project) => (
          <li
            key={project.slug}
            class="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-900 p-2"
          >
            <div class="min-w-0 flex-1">
              <a class="text-sky-300" href={`#/p/${project.slug}`}>
                {project.name}
              </a>
              {project.needs_upgrade && (
                <span class="ml-2">
                  <Badge tone="warn">older format</Badge>
                </span>
              )}
              <FolderPath path={project.folder} />
              {project.file.split("/").pop() !== "project.edith" && (
                <div class="font-mono text-[11px] text-neutral-500">
                  {project.file.split("/").pop()}
                </div>
              )}
            </div>
            <span class="shrink-0 text-xs text-neutral-500">{when(project.last_opened)}</span>
            {/* Says what it does, in words: it only takes the entry off this list. */}
            <button
              class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              aria-label={`Remove ${project.name} from the list`}
              title="Take it off this list. The project and its media stay on disk."
              onClick={() => forget(project)}
            >
              <Icon icon={Close} />
              Remove from list
            </button>
          </li>
        ))}
      </ul>
      {dialog === "new" && (
        <FolderBrowser
          mode="choose"
          title="New project: select the folder that holds the media"
          confirmLabel="Create project here"
          onChoose={create}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "open" && (
        <FolderBrowser
          mode="open"
          title="Open a project: select its .edith file (or the folder that has it)"
          confirmLabel="Open this project"
          onChoose={open}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}

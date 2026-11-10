import { useEffect, useState } from "preact/hooks";

import { createProject, fetchProjects, forgetProject, openProject, type Project } from "../lib/api";
import { FolderBrowser } from "./FolderBrowser";
import { FolderPath } from "./FolderPath";
import { Icon } from "./Icon";
import { Badge, Button } from "./ui";
import { Close, Folder, Plus, Warning } from "./icons";

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
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const load = () => fetchProjects().then(setProjects).catch(fail);
  useEffect(() => {
    void load();
  }, []);

  const create = (folder: string) =>
    createProject(name.trim() || basename(folder), folder).then(goTo, (e: unknown) => {
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
            class={`flex items-center gap-3 rounded border border-neutral-800 bg-neutral-900 p-2 ${project.available ? "" : "opacity-70"}`}
          >
            <div class="min-w-0 flex-1">
              {project.available ? (
                <a class="text-sky-300" href={`#/p/${project.slug}`}>
                  {project.name}
                </a>
              ) : (
                <span class="text-neutral-300">{project.name}</span>
              )}
              {project.needs_upgrade && (
                <span class="ml-2">
                  <Badge tone="warn">older format</Badge>
                </span>
              )}
              <FolderPath path={project.folder} />
              {!project.available && (
                <div class="mt-0.5 flex items-center gap-1 text-xs text-amber-300">
                  <Icon icon={Warning} />
                  Can&apos;t find this folder right now (a drive unplugged, or it was moved).
                </div>
              )}
            </div>
            <span class="shrink-0 text-xs text-neutral-500">{when(project.last_opened)}</span>
            <button
              class="shrink-0 text-neutral-500 hover:text-red-400"
              aria-label={`Forget ${project.name}`}
              title="Take it off this list (nothing on disk is touched)"
              onClick={() => forget(project)}
            >
              <Icon icon={Close} />
            </button>
          </li>
        ))}
      </ul>
      {dialog === "new" && (
        <FolderBrowser
          mode="choose"
          title="New project: choose the folder that holds the media"
          confirmLabel="Create project here"
          onChoose={create}
          onClose={() => setDialog(null)}
          header={
            <label class="mt-2 flex items-center gap-2 text-sm text-neutral-300">
              Name
              <input
                class="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
                aria-label="Project name"
                placeholder="(the folder's name)"
                value={name}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </label>
          }
        />
      )}
      {dialog === "open" && (
        <FolderBrowser
          mode="open"
          title="Open a project: choose its folder"
          confirmLabel="Open this project"
          onChoose={open}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}

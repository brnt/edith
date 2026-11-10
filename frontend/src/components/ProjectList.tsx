import { useEffect, useState } from "preact/hooks";

import { createProject, fetchProjects, type Project } from "../lib/api";
import { Badge, Button } from "./ui";

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    fetchProjects().then(setProjects).catch(fail);
  }, []);

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createProject(trimmed)
      .then((project) => {
        setProjects((current) => [...current, project]);
        setName("");
        setError(null);
      })
      .catch(fail);
  };

  return (
    <main class="mx-auto max-w-2xl p-8">
      <h1 class="text-2xl font-bold">Edith</h1>
      <p class="mt-1 text-sm text-neutral-400">
        Sync, cut, and switch cameras for long-form recordings.
      </p>
      {error && <p class="mt-2 text-red-400">{error}</p>}
      <form class="mt-4 flex gap-2" onSubmit={onSubmit}>
        <input
          class="flex-1 rounded border border-neutral-700 bg-neutral-900 p-2"
          aria-label="Project name"
          placeholder="New project name"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <Button variant="primary" type="submit">
          Create
        </Button>
      </form>
      <ul class="mt-4 space-y-2">
        {projects.map((project) => (
          <li key={project.slug} class="rounded border border-neutral-800 bg-neutral-900 p-2">
            <a class="text-sky-300" href={`#/p/${project.slug}`}>
              {project.name}
            </a>
            {project.needs_upgrade && (
              <span class="ml-2">
                <Badge tone="warn">older format</Badge>
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

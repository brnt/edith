import { useEffect, useState } from "preact/hooks";

import { createProject, fetchProjects, type Project } from "./lib/api";

export function App() {
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
      {error && <p class="mt-2 text-red-600">{error}</p>}
      <form class="mt-4 flex gap-2" onSubmit={onSubmit}>
        <input
          class="flex-1 rounded border border-gray-300 p-2"
          aria-label="Project name"
          placeholder="New project name"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button class="rounded bg-gray-900 px-4 py-2 text-white" type="submit">
          Create
        </button>
      </form>
      <ul class="mt-4 space-y-2">
        {projects.map((project) => (
          <li key={project.slug} class="rounded border border-gray-200 p-2">
            {project.name}
            {project.needs_upgrade && (
              <span class="ml-2 rounded bg-amber-100 px-2 text-sm text-amber-800">
                older format
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const TOKEN = import.meta.env.VITE_API_TOKEN ?? "dev-token";

export interface Project {
  slug: string;
  name: string;
  created_at: string;
  needs_upgrade: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function fetchProjects(): Promise<Project[]> {
  return request<Project[]>("/projects");
}

export function createProject(name: string): Promise<Project> {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

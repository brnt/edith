import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";

import { App } from "./app";

const existing = {
  slug: "pilot",
  name: "Pilot",
  created_at: "2026-01-01T00:00:00Z",
  needs_upgrade: true,
};

function reply(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

test("lists projects and flags older formats", async () => {
  fetchMock.mockImplementation(() => reply([existing]));
  render(<App />);
  await waitFor(() => expect(screen.getByText("Pilot")).toBeInTheDocument());
  expect(screen.getByText("older format")).toBeInTheDocument();
});

test("creates a project and shows it", async () => {
  const created = { ...existing, slug: "ep-1", name: "Ep 1", needs_upgrade: false };
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    reply(init?.method === "POST" ? created : []),
  );
  render(<App />);
  fireEvent.input(screen.getByLabelText("Project name"), { target: { value: "Ep 1" } });
  fireEvent.click(screen.getByText("Create"));
  await waitFor(() => expect(screen.getByText("Ep 1")).toBeInTheDocument());
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(post![1].body)).toEqual({ name: "Ep 1" });
});

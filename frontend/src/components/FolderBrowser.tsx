import { useEffect, useState } from "preact/hooks";

import {
  fetchPlaces,
  listFolders,
  type FolderEntry,
  type FolderListing,
  type Place,
} from "../lib/api";
import { Button } from "./ui";
import { Icon } from "./Icon";
import { ArrowUp, CaretRight, Check, Close, Folder } from "./icons";

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/**
 * Pick a folder anywhere on disk: click to select, double-click (or the arrow) to go inside, and the
 * button acts on the selected folder, or on the one you are in when none is selected. `choose`: the folder for a new project (the one holding the
 * media), optionally a new sub-folder of it. `open`: a folder that has a project (.edith file) in it.
 */
export function FolderBrowser({
  mode,
  title,
  confirmLabel,
  onChoose,
  onClose,
  header,
}: {
  mode: "choose" | "open";
  title: string;
  confirmLabel: string;
  onChoose: (folder: string) => void;
  onClose: () => void;
  /** Extra controls above the folder list (the new-project dialog's name field). */
  header?: preact.ComponentChildren;
}) {
  const [dir, setDir] = useState("");
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<FolderEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlaces().then(setPlaces, () => undefined);
  }, []);
  useEffect(() => {
    listFolders(dir).then(
      (l) => {
        setListing(l);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [dir]);

  const goInto = (path: string) => {
    setSelected(null);
    setDir(path);
  };

  // The folder the button acts on: the one you selected, else the one you are looking inside.
  const target = selected
    ? { path: selected.path, name: selected.name, isProject: selected.is_project }
    : {
        path: listing?.dir ?? "",
        name: basename(listing?.dir ?? ""),
        isProject: !!listing?.is_project,
      };
  const chosen = newName.trim()
    ? `${target.path.replace(/\/+$/, "")}/${newName.trim()}`
    : target.path;
  // Open needs a folder holding a project; a new project can't go in (or inside) one.
  const usable = !!listing && (mode === "open" ? target.isProject : !target.isProject);

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-label={title}
    >
      <div class="flex max-h-[85vh] w-[36rem] flex-col rounded border border-neutral-700 bg-neutral-900 p-4">
        <h3 class="font-semibold">{title}</h3>
        {header}
        <div class="mt-2 flex shrink-0 flex-wrap gap-1 text-xs">
          {places.map((pl) => (
            <button
              key={pl.path}
              class="rounded bg-neutral-800 px-2 py-0.5 text-sky-300 hover:bg-neutral-700"
              onClick={() => goInto(pl.path)}
            >
              {pl.name}
            </button>
          ))}
        </div>
        <p
          class="mt-2 shrink-0 truncate font-mono text-xs text-neutral-400"
          title={listing?.dir}
          data-testid="folder-path"
        >
          {listing?.dir}
        </p>
        {error && <p class="mt-1 text-sm text-red-400">{error}</p>}
        <ul class="mt-2 min-h-[10rem] flex-1 space-y-0.5 overflow-y-auto text-sm">
          {listing?.parent != null && (
            <li>
              <button
                class="inline-flex items-center gap-1.5 px-1 text-sky-400"
                onClick={() => goInto(listing.parent ?? "")}
              >
                <Icon icon={ArrowUp} />
                up
              </button>
            </li>
          )}
          {listing?.entries.map((e) => {
            const on = selected?.path === e.path;
            return (
              <li
                key={e.path}
                class={`flex items-center gap-1 rounded px-1 ${on ? "bg-sky-900/60" : "hover:bg-neutral-800"}`}
              >
                <button
                  class="inline-flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-sky-300"
                  aria-pressed={on}
                  title="Click to select, double-click to go inside"
                  onClick={() => setSelected(e)}
                  onDblClick={() => goInto(e.path)}
                >
                  <Icon icon={Folder} />
                  <span class="truncate">{e.name}</span>
                  {e.is_project && (
                    <span
                      class="shrink-0 rounded bg-emerald-900 px-1.5 text-[11px] text-emerald-200"
                      title="This folder has a project in it (a .edith file)"
                    >
                      .edith
                    </span>
                  )}
                </button>
                <button
                  class="shrink-0 p-0.5 text-neutral-400 hover:text-neutral-100"
                  aria-label={`Go inside ${e.name}`}
                  title="Go inside"
                  onClick={() => goInto(e.path)}
                >
                  <Icon icon={CaretRight} />
                </button>
              </li>
            );
          })}
          {listing && listing.entries.length === 0 && (
            <li class="px-1 text-neutral-500">No folders here.</li>
          )}
        </ul>
        {mode === "choose" && (
          <label class="mt-2 flex items-center gap-2 text-sm text-neutral-300">
            New folder inside (optional)
            <input
              class="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
              aria-label="New folder name"
              placeholder="e.g. Episode 12"
              value={newName}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
          </label>
        )}
        {listing && (
          <p
            class={`mt-2 text-xs ${usable ? "text-neutral-400" : "text-amber-300"}`}
            data-testid="folder-hint"
          >
            {mode === "open"
              ? target.isProject
                ? `Open the project in “${target.name}”.`
                : `There is no .edith project file in “${target.name}”: select the folder that contains one.`
              : target.isProject
                ? `“${target.name}” already has a project in it: choose another folder.`
                : newName.trim()
                  ? `A new folder “${newName.trim()}” will be made in “${target.name}”.`
                  : `The project will live in “${target.name}” (put the media there).`}
          </p>
        )}
        <div class="mt-3 flex justify-end gap-2">
          <Button variant="ghost" icon={Close} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Check}
            disabled={!usable}
            onClick={() => onChoose(chosen)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

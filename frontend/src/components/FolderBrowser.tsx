import { useEffect, useState } from "preact/hooks";

import { fetchPlaces, listFolders, type FolderListing, type Place } from "../lib/api";
import { Button } from "./ui";
import { Icon } from "./Icon";
import { ArrowUp, Check, Close, Folder } from "./icons";

/**
 * Pick a folder anywhere on disk. `choose`: the folder for a new project (the one holding the
 * media), optionally a new sub-folder of it. `open`: a folder that already holds a project.
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

  const here = listing?.dir ?? "";
  const chosen = newName.trim() ? `${here.replace(/\/$/, "")}/${newName.trim()}` : here;
  // A new project can't go in a folder that is a project, nor inside one.
  const usable = mode === "open" ? !!listing?.is_project : !!listing && !listing.is_project;

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
              onClick={() => setDir(pl.path)}
            >
              {pl.name}
            </button>
          ))}
        </div>
        <p
          class="mt-2 shrink-0 truncate font-mono text-xs text-neutral-400"
          title={here}
          data-testid="folder-path"
        >
          {here}
        </p>
        {error && <p class="mt-1 text-sm text-red-400">{error}</p>}
        <ul class="mt-2 min-h-[10rem] flex-1 space-y-1 overflow-y-auto text-sm">
          {listing?.parent != null && (
            <li>
              <button
                class="inline-flex items-center gap-1.5 text-sky-400"
                onClick={() => setDir(listing.parent ?? "")}
              >
                <Icon icon={ArrowUp} />
                up
              </button>
            </li>
          )}
          {listing?.entries.map((e) => (
            <li key={e.path}>
              <button
                class="inline-flex items-center gap-1.5 text-sky-400"
                onClick={() => setDir(e.path)}
              >
                <Icon icon={Folder} />
                {e.name}
                {e.is_project && (
                  <span class="rounded bg-emerald-900 px-1.5 text-[11px] text-emerald-200">
                    project
                  </span>
                )}
              </button>
            </li>
          ))}
          {listing && listing.entries.length === 0 && (
            <li class="text-neutral-500">No folders here.</li>
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
        {mode === "choose" && listing?.is_project && (
          <p class="mt-1 text-xs text-amber-300">This folder already holds a project.</p>
        )}
        {mode === "open" && listing && !listing.is_project && (
          <p class="mt-1 text-xs text-neutral-500">
            Go into a folder marked “project”, then open it.
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

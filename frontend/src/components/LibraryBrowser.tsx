import { useEffect, useState } from "preact/hooks";

import { listLibrary, type LibraryListing, type MediaKind } from "../lib/api";
import { Button } from "./ui";

const KIND_LABEL = { video: "video", audio: "audio", image: "image" } as const;

export function LibraryBrowser({
  onAdd,
  onClose,
  kinds,
  single = false,
  title = "Add media from",
  confirmLabel,
}: {
  onAdd: (paths: string[]) => void;
  onClose: () => void;
  /** Show only these kinds of file (folders are always shown). */
  kinds?: MediaKind[];
  /** Pick exactly one file instead of several. */
  single?: boolean;
  title?: string;
  confirmLabel?: string;
}) {
  const [dir, setDir] = useState("");
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLibrary(dir)
      .then(setListing)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [dir]);

  const toggle = (path: string) =>
    setSelected((current) => {
      if (single) return new Set([path]);
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog">
      <div class="flex max-h-[80vh] w-[32rem] flex-col rounded border border-neutral-700 bg-neutral-900 p-4">
        <h3 class="font-semibold">
          {title} /{listing?.dir}
        </h3>
        {error && <p class="mt-2 text-red-400">{error}</p>}
        <ul class="mt-3 flex-1 space-y-1 overflow-y-auto text-sm">
          {listing?.parent !== null && listing && (
            <li>
              <button class="text-sky-400" onClick={() => setDir(listing.parent ?? "")}>
                ↑ up
              </button>
            </li>
          )}
          {listing?.entries
            .filter((e) => e.is_dir || !kinds || (e.kind !== null && kinds.includes(e.kind)))
            .map((entry) => (
              <li key={entry.path} class="flex items-center gap-2">
                {entry.is_dir ? (
                  <button class="text-sky-400" onClick={() => setDir(entry.path)}>
                    📁 {entry.name}
                  </button>
                ) : (
                  <label class="flex items-center gap-2">
                    <input
                      type={single ? "radio" : "checkbox"}
                      checked={selected.has(entry.path)}
                      onChange={() => toggle(entry.path)}
                    />
                    {entry.name}
                    <span class="text-xs text-neutral-500">
                      {entry.kind ? KIND_LABEL[entry.kind] : ""}
                    </span>
                  </label>
                )}
              </li>
            ))}
          {listing && listing.entries.length === 0 && (
            <li class="text-neutral-500">No media files here.</li>
          )}
        </ul>
        <div class="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            onClick={() => onAdd([...selected])}
          >
            {confirmLabel ?? `Add ${selected.size || ""} selected`}
          </Button>
        </div>
      </div>
    </div>
  );
}

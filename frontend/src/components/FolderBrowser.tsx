import { useEffect, useRef, useState } from "preact/hooks";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";

import {
  createFolder,
  fetchPlaces,
  listFolders,
  type FileEntry,
  type FolderEntry,
  type FolderListing,
  type Place,
} from "../lib/api";
import { Button } from "./ui";
import { Icon } from "./Icon";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Close,
  File,
  Folder,
  FolderAdd,
  Hdd,
  Home,
  Picture,
  Sound,
  VideoCamera,
} from "./icons";

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** A press that starts on the dimmed backdrop itself (not inside the dialog) dismisses the dialog. */
const dismissOnBackdrop = (onClose: () => void) => (e: MouseEvent) => {
  if (e.target === e.currentTarget) onClose();
};

/** A sidebar place's icon: the home folder, or a mounted drive (a hard drive). */
const placeIcon = (place: Place): IconDefinition => (place.kind === "drive" ? Hdd : Home);

/** The path as text, each folder in it a link to that level (the last, where you are, is plain). */
function PathText({ dir, onGo }: { dir: string; onGo: (path: string) => void }) {
  const parts = dir.split("/").filter(Boolean);
  const link = "rounded hover:text-sky-300 hover:underline";
  return (
    <>
      {parts.length > 0 ? (
        <button type="button" class={link} title="Go to /" onClick={() => onGo("/")}>
          /
        </button>
      ) : (
        "/"
      )}
      {parts.map((part, i) => {
        const path = `/${parts.slice(0, i + 1).join("/")}`;
        return (
          <span key={path}>
            {i < parts.length - 1 ? (
              <>
                <button
                  type="button"
                  class={link}
                  title={`Go to ${path}`}
                  onClick={() => onGo(path)}
                >
                  {part}
                </button>
                /
              </>
            ) : (
              part
            )}
          </span>
        );
      })}
    </>
  );
}

/** A small dialog over the picker: name a folder to make in the folder being looked at. */
function NewFolderDialog({
  parentName,
  onCreate,
  onClose,
}: {
  parentName: string;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      role="dialog"
      aria-label="New folder"
      onMouseDown={dismissOnBackdrop(onClose)}
    >
      <form
        class="w-80 rounded border border-neutral-600 bg-neutral-900 p-4 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 class="font-semibold">New folder</h3>
        <p class="mt-1 truncate text-xs text-neutral-400">in “{parentName}”</p>
        <input
          ref={input}
          class="mt-3 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
          aria-label="Folder name"
          placeholder="Untitled folder"
          value={name}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
        />
        <p class="mt-2 min-h-8 text-xs text-amber-300" role="alert">
          {error}
        </p>
        <div class="mt-2 flex justify-end gap-2">
          <Button variant="ghost" icon={Close} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={FolderAdd} type="submit" disabled={!name.trim() || busy}>
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Pick a folder anywhere on disk, laid out like the macOS Finder's Open and Save panels: the home folder and
 * mounted drives in a sidebar on the left, back and forward, the path (every folder in it a link) above the
 * list, click to select and double-click to go inside, and New Folder at the bottom left. The panel
 * is one size however many folders there are, and a click outside it, or Esc, dismisses it. `choose`: the
 * folder for a new project (the one holding the media). `open`: a folder that has a project
 * (.edith file) in it, or the file itself.
 */
export function FolderBrowser({
  mode,
  title,
  confirmLabel,
  onChoose,
  onClose,
}: {
  mode: "choose" | "open";
  title: string;
  confirmLabel: string;
  /** The chosen folder; for a new project, also the name typed for it (empty = the folder's name). */
  onChoose: (folder: string, name: string) => void;
  onClose: () => void;
}) {
  const [dir, setDir] = useState("");
  // Where you have been, for Back and Forward (`at` is the one being shown).
  const [history, setHistory] = useState<{ stack: string[]; at: number }>({ stack: [""], at: 0 });
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  // What is selected: a folder, or (when opening) a project file. Nothing selected = this folder.
  const [selected, setSelected] = useState<FolderEntry | FileEntry | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
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

  // Esc dismisses the topmost dialog: the New Folder one if it is up, else the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (making) setMaking(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [making, onClose]);

  const goInto = (path: string) => {
    setSelected(null);
    setHistory(({ stack, at }) => ({ stack: [...stack.slice(0, at + 1), path], at: at + 1 }));
    setDir(path);
  };
  const step = (by: -1 | 1) => {
    const at = history.at + by;
    if (at < 0 || at >= history.stack.length) return;
    setSelected(null);
    setHistory({ ...history, at });
    setDir(history.stack[at]);
  };

  const makeFolder = async (name: string) => {
    if (!listing) return;
    const updated = await createFolder(listing.dir, name);
    setListing(updated);
    // Select what was just made, so Choose acts on it.
    setSelected(updated.entries.find((e) => e.name === name.trim()) ?? null);
    setMaking(false);
  };

  const selectedFolder = selected && "edith_files" in selected ? selected : null;
  const selectedFile = selected && !("edith_files" in selected) ? selected : null;
  const folderTarget: { path: string; name: string; projects: number } = selectedFolder
    ? { path: selectedFolder.path, name: selectedFolder.name, projects: selectedFolder.edith_files }
    : {
        path: listing?.dir ?? "",
        name: basename(listing?.dir ?? ""),
        projects: listing?.files.length ?? 0,
      };
  // Open: a selected project file, else a folder that has exactly one. New: any folder; one that
  // already has a project can hold another (two cuts of one shoot share the media), saved beside it.
  const openPath = selectedFile
    ? selectedFile.path
    : folderTarget.projects === 1
      ? folderTarget.path
      : null;
  const usable = !!listing && (mode === "open" ? openPath !== null : true);
  const hint =
    mode === "open"
      ? selectedFile
        ? `Open “${selectedFile.name}”.`
        : folderTarget.projects === 1
          ? `Open the project in “${folderTarget.name}”.`
          : folderTarget.projects > 1
            ? `“${folderTarget.name}” has ${folderTarget.projects} projects: go inside and select one.`
            : `There is no .edith project file in “${folderTarget.name}”: select the folder that contains one.`
      : `The project will live in “${folderTarget.name}” (put the media there).`;

  // What the primary button does (and Enter in the name field).
  const confirm = () => {
    if (usable) onChoose(mode === "open" ? (openPath ?? "") : folderTarget.path, name.trim());
  };

  const sidebarItem = (place: Place) => (
    <li key={place.path}>
      <button
        type="button"
        class={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${listing?.dir === place.path ? "bg-neutral-700 text-white" : "text-neutral-300 hover:bg-neutral-800"}`}
        title={place.path}
        onClick={() => goInto(place.path)}
      >
        <Icon icon={placeIcon(place)} class="text-sky-300" />
        <span class="truncate">{place.name}</span>
      </button>
    </li>
  );
  const drives = places.filter((p) => p.kind === "drive");

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-label={title}
      onMouseDown={dismissOnBackdrop(onClose)}
    >
      {/* A fixed height: the controls must not move as folders are opened. */}
      <div class="flex h-[34rem] max-h-[92vh] w-[46rem] max-w-[96vw] flex-col rounded border border-neutral-700 bg-neutral-900 p-4">
        <h3 class="shrink-0 font-semibold">{title}</h3>
        {mode === "choose" && (
          // Several projects can share a folder, so the folder's name is only the default.
          <label class="mt-2 flex shrink-0 items-center gap-2 text-sm text-neutral-300">
            Project name
            <input
              class="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1"
              aria-label="Project name"
              placeholder="(defaults to the folder's name)"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          </label>
        )}
        <div class="mt-3 flex min-h-0 flex-1 gap-3">
          <nav
            class="flex w-40 shrink-0 flex-col gap-3 overflow-y-auto rounded bg-neutral-950 p-1.5 text-sm"
            aria-label="Places"
          >
            <ul>{places.filter((p) => p.kind !== "drive").map(sidebarItem)}</ul>
            {drives.length > 0 && (
              <ul class="border-t border-neutral-800 pt-1.5">{drives.map(sidebarItem)}</ul>
            )}
          </nav>
          <div class="flex min-w-0 flex-1 flex-col">
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="rounded p-1 text-neutral-300 hover:bg-neutral-800 disabled:text-neutral-600 disabled:hover:bg-transparent"
                aria-label="Back"
                title="Back"
                disabled={history.at === 0}
                onClick={() => step(-1)}
              >
                <Icon icon={ArrowLeft} />
              </button>
              <button
                type="button"
                class="rounded p-1 text-neutral-300 hover:bg-neutral-800 disabled:text-neutral-600 disabled:hover:bg-transparent"
                aria-label="Forward"
                title="Forward"
                disabled={history.at >= history.stack.length - 1}
                onClick={() => step(1)}
              >
                <Icon icon={ArrowRight} />
              </button>
              <p
                class="ml-1 min-w-0 flex-1 truncate font-mono text-xs text-neutral-400"
                title={listing?.dir}
                data-testid="folder-path"
              >
                {listing && <PathText dir={listing.dir} onGo={goInto} />}
              </p>
            </div>
            <ul class="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded bg-neutral-950 p-1 text-sm">
              {listing?.entries.map((e) => {
                const on = selected?.path === e.path;
                return (
                  <li key={e.path}>
                    <button
                      type="button"
                      class={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left ${on ? "bg-sky-900/70 text-white" : "text-neutral-200 hover:bg-neutral-800"}`}
                      aria-pressed={on}
                      title="Click to select, double-click to go inside"
                      onClick={() => setSelected(e)}
                      onDblClick={() => goInto(e.path)}
                    >
                      <Icon icon={Folder} class="text-sky-300" />
                      <span class="truncate">{e.name}</span>
                    </button>
                  </li>
                );
              })}
              {listing?.files.map((f) => {
                const on = mode === "open" && selected?.path === f.path;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      class={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left ${mode === "choose" ? "cursor-default text-emerald-300/70" : on ? "bg-sky-900/70 text-white" : "text-emerald-300 hover:bg-neutral-800"}`}
                      aria-pressed={on}
                      aria-disabled={mode === "choose" || undefined}
                      title={
                        mode === "choose"
                          ? "A project that is already in this folder"
                          : "A project: select it, then Open"
                      }
                      onClick={() => mode === "open" && setSelected(f)}
                    >
                      <Icon icon={File} />
                      <span class="truncate">{f.name}</span>
                    </button>
                  </li>
                );
              })}
              {listing?.media.map((m) => (
                <li key={m.name}>
                  <div
                    class="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-neutral-500"
                    aria-disabled="true"
                    title={`A ${m.kind} file Edith can use: shown to help you recognise the folder`}
                    data-testid="media-file"
                  >
                    <Icon
                      icon={m.kind === "video" ? VideoCamera : m.kind === "audio" ? Sound : Picture}
                    />
                    <span class="truncate">{m.name}</span>
                  </div>
                </li>
              ))}
              {listing && listing.media_more > 0 && (
                <li class="px-1.5 py-0.5 text-xs text-neutral-500">
                  …and {listing.media_more} more media files
                </li>
              )}
              {listing &&
                listing.entries.length === 0 &&
                !listing.files.length &&
                !listing.media.length && (
                  <li class="px-2 py-1 text-neutral-500">This folder is empty.</li>
                )}
            </ul>
          </div>
        </div>
        {/* One reserved block for the hint or an error, so it never changes the dialog's height. */}
        <p
          class={`mt-2 h-8 shrink-0 text-xs ${error || !usable ? "text-amber-300" : "text-neutral-400"}`}
          data-testid="folder-hint"
        >
          {error ?? (listing ? hint : "")}
        </p>
        <div class="mt-1 flex shrink-0 items-center justify-between gap-2">
          {mode === "choose" ? (
            <Button icon={FolderAdd} disabled={!listing} onClick={() => setMaking(true)}>
              New Folder
            </Button>
          ) : (
            <span />
          )}
          <div class="flex gap-2">
            <Button variant="ghost" icon={Close} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={Check} disabled={!usable} onClick={confirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
      {making && listing && (
        <NewFolderDialog
          parentName={basename(listing.dir)}
          onCreate={makeFolder}
          onClose={() => setMaking(false)}
        />
      )}
    </div>
  );
}

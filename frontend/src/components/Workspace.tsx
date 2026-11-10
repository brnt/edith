import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import {
  fetchEdit,
  fetchMedia,
  fetchPeaks,
  fetchPlan,
  fetchProject,
  fetchSync,
  putEdit,
  upgradeProject,
  type EditList,
  type MediaItem,
  type Peaks,
  type Plan,
  type Project,
  type SyncState,
} from "../lib/api";
import * as history from "../lib/history";
import { sortMedia } from "../lib/timeline";
import { Studio } from "./Studio";
import { Badge, Button } from "./ui";

export function Workspace({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [hist, setHist] = useState<history.History<EditList> | null>(null);
  const [saved, setSaved] = useState<EditList | null>(null);
  const [peaks, setPeaks] = useState<Record<string, Peaks>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const requested = useRef(new Set<string>());

  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const edit = hist?.present ?? null;
  const dirty = hist !== null && saved !== hist.present;

  const refreshMedia = useCallback(
    () =>
      fetchMedia(slug)
        .then((list) => setMedia(sortMedia(list)))
        .catch(fail),
    [slug, fail],
  );
  const refreshSync = useCallback(() => fetchSync(slug).then(setSync).catch(fail), [slug, fail]);
  const refreshPlan = useCallback(() => fetchPlan(slug).then(setPlan).catch(fail), [slug, fail]);
  const refreshProject = useCallback(
    () => fetchProject(slug).then(setProject).catch(fail),
    [slug, fail],
  );

  useEffect(() => {
    void refreshProject();
    Promise.all([refreshMedia(), refreshSync()]).then(() => setReady(true));
    void refreshPlan();
    fetchEdit(slug)
      .then(({ edit: loaded }) => {
        setHist(history.start(loaded));
        setSaved(loaded);
      })
      .catch(fail);
  }, [slug]);

  // Waveforms for everything that has audio, loaded once per file.
  useEffect(() => {
    for (const m of media) {
      if (!m.has_audio || m.kind === "image" || requested.current.has(m.id)) continue;
      requested.current.add(m.id);
      fetchPeaks(slug, m.id)
        .then((data) => setPeaks((current) => ({ ...current, [m.id]: data })))
        .catch(fail);
    }
  }, [media, slug]);

  const onEdit = useCallback(
    (next: EditList) => setHist((h) => (h ? history.push(h, next) : h)),
    [],
  );

  const save = useCallback(async () => {
    if (!hist) return;
    setSaving(true);
    try {
      await putEdit(slug, hist.present);
      setSaved(hist.present);
      await Promise.all([refreshProject(), refreshPlan()]);
      setError(null);
    } catch (e) {
      fail(e);
    }
    setSaving(false);
  }, [hist, slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "s") {
        e.preventDefault();
        void save();
      } else if (e.key === "z" && !typing) {
        e.preventDefault();
        setHist((h) => (h ? (e.shiftKey ? history.redo(h) : history.undo(h)) : h));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const upgrade = async () => {
    try {
      setProject(await upgradeProject(slug));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div class="flex h-screen flex-col">
      <header class="flex shrink-0 flex-wrap items-center gap-3 px-3 py-2">
        <a href="#/" class="text-sky-300">
          ← Projects
        </a>
        <h1 class="text-xl font-bold">{project?.name ?? slug}</h1>
        {dirty && <Badge tone="warn">unsaved changes</Badge>}
        <div class="ml-auto flex items-center gap-2">
          <Button
            disabled={!hist || hist.past.length === 0}
            onClick={() => setHist((h) => (h ? history.undo(h) : h))}
          >
            Undo
          </Button>
          <Button
            disabled={!hist || hist.future.length === 0}
            onClick={() => setHist((h) => (h ? history.redo(h) : h))}
          >
            Redo
          </Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {project?.needs_upgrade && (
        <div class="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded border border-amber-700 bg-amber-950 p-2 text-sm text-amber-200">
          This project was saved by an older version of Edith. It opened as it was; saving your edit
          or upgrading rewrites it in the current format.
          <Button onClick={upgrade}>Upgrade now</Button>
        </div>
      )}
      {error && (
        <div class="mx-3 mb-2 flex shrink-0 items-center justify-between rounded border border-red-800 bg-red-950 p-2 text-sm text-red-200">
          {error}
          <Button variant="ghost" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {edit ? (
        <Studio
          slug={slug}
          media={media}
          sync={sync}
          edit={edit}
          peaks={peaks}
          warnings={plan?.warnings ?? []}
          outputSeconds={plan?.duration_s ?? null}
          dirty={dirty}
          ready={ready}
          onEdit={onEdit}
          onMediaChange={() => {
            void refreshMedia();
            void refreshSync();
            void refreshPlan();
          }}
          onSyncChange={() => {
            void refreshSync();
            void refreshPlan();
          }}
          onError={setError}
        />
      ) : (
        <p class="p-3 text-neutral-500">Loading…</p>
      )}
    </div>
  );
}

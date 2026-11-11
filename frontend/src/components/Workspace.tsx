import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  fetchEdit,
  fetchMedia,
  fetchPeaks,
  fetchPlan,
  fetchProject,
  fetchSync,
  putEdit,
  touchProject,
  upgradeProject,
  type EditList,
  type MediaItem,
  type Peaks,
  type Plan,
  type Project,
  type SyncState,
} from "../lib/api";
import { renameMedia } from "../lib/editOps";
import * as history from "../lib/history";
import { sortMedia } from "../lib/timeline";
import { FolderPath } from "./FolderPath";
import { Studio } from "./Studio";
import { Badge, Button, ButtonGroup } from "./ui";
import { Icon } from "./Icon";
import { ArrowLeft, Close, Redo, Save, Sync, Undo } from "./icons";

const MEDIA_POLL_MS = 5000;

/** Undo, redo and save in the ribbon's tab strip: icon-only, 7:4 like the transport buttons. */
const HISTORY = "h-6 w-[42px] justify-center px-0 py-0 text-sm";

export function Workspace({ slug }: { slug: string }) {
  const [project, setProject] = useState<Project | null>(null);
  // Everything in the project folder, included in the project or not; the editor only sees the
  // included media.
  const [available, setAvailable] = useState<MediaItem[]>([]);
  const media = useMemo(() => available.filter((m) => m.included), [available]);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [hist, setHist] = useState<history.History<EditList> | null>(null);
  const [saved, setSaved] = useState<EditList | null>(null);
  const [peaks, setPeaks] = useState<Record<string, Peaks>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
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
        .then((list) => {
          const next = sortMedia(list);
          // Polling returns the same list almost every time: keep the old one (and skip a render).
          setAvailable((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        })
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
    touchProject(slug).catch(() => undefined); // it goes to the top of the recent list
    Promise.all([refreshMedia(), refreshSync()]).then(() => setReady(true));
    void refreshPlan();
    fetchEdit(slug)
      .then(({ edit: loaded }) => {
        setHist(history.start(loaded));
        setSaved(loaded);
      })
      .catch(fail);
  }, [slug]);

  // New files appear in the media tab on their own: look again every few seconds while the page is
  // visible, and as soon as the window regains focus (e.g. after copying files in the Finder).
  useEffect(() => {
    const look = () => {
      if (!document.hidden) void refreshMedia();
    };
    const timer = window.setInterval(look, MEDIA_POLL_MS);
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [refreshMedia]);

  // Waveforms for everything that has audio, loaded once per file (again on Retry after a failure).
  const failedPeaks = useRef(new Set<string>());
  const loadPeaks = useCallback(
    (id: string) => {
      requested.current.add(id);
      fetchPeaks(slug, id)
        .then((data) => {
          setPeaks((current) => ({ ...current, [id]: data }));
          const wasFailed = failedPeaks.current.delete(id);
          if (wasFailed && failedPeaks.current.size === 0) {
            setError(null);
            setRetry(null);
          }
        })
        .catch((e) => {
          requested.current.delete(id); // so Retry can try again
          failedPeaks.current.add(id);
          fail(e);
          setRetry(() => () => {
            setError(null);
            setRetry(null);
            for (const failed of [...failedPeaks.current]) loadPeaks(failed);
          });
        });
    },
    [slug, fail],
  );
  useEffect(() => {
    for (const m of available) {
      if (!m.has_audio || m.kind === "image" || m.missing || requested.current.has(m.id)) continue;
      loadPeaks(m.id);
    }
  }, [available, slug]);

  // A media item was relinked to another file (and so another id): the edit follows it, in the
  // saved copy and in every undo step, without counting as a change of its own.
  const onRelinked = useCallback((from: string, to: string) => {
    const memo = new Map<EditList, EditList>();
    const rename = (e: EditList) => {
      if (!memo.has(e)) memo.set(e, renameMedia(e, from, to));
      return memo.get(e)!;
    };
    setSaved((s) => (s ? rename(s) : s));
    setHist((h) => (h ? history.mapAll(h, rename) : h));
  }, []);

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
        <a href="#/" class="inline-flex items-center gap-1.5 text-sky-300">
          <Icon icon={ArrowLeft} />
          Projects
        </a>
        <h1 class="text-xl font-bold">{project?.name ?? "…"}</h1>
        {project && <FolderPath path={project.folder} class="max-w-[45vw]" />}
        {dirty && <Badge tone="warn">unsaved changes</Badge>}
      </header>

      {project?.needs_upgrade && (
        <div class="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded border border-amber-700 bg-amber-950 px-2 py-1 text-sm text-amber-200">
          Saved by an older Edith. It opened unchanged; saving or upgrading rewrites it in the
          current format.
          <Button icon={Sync} onClick={upgrade}>
            Upgrade now
          </Button>
        </div>
      )}
      {error && (
        <div class="mx-3 mb-2 flex shrink-0 items-center justify-between rounded border border-red-800 bg-red-950 p-2 text-sm text-red-200">
          {error}
          <span class="flex gap-1">
            {retry && (
              <Button variant="ghost" icon={Sync} onClick={retry}>
                Retry
              </Button>
            )}
            <Button
              variant="ghost"
              icon={Close}
              onClick={() => {
                setError(null);
                setRetry(null);
              }}
            >
              Dismiss
            </Button>
          </span>
        </div>
      )}

      {edit ? (
        <Studio
          slug={slug}
          actions={
            <>
              <ButtonGroup>
                <Button
                  icon={Undo}
                  class={HISTORY}
                  title="Undo"
                  aria-label="Undo"
                  disabled={!hist || hist.past.length === 0}
                  onClick={() => setHist((h) => (h ? history.undo(h) : h))}
                />
                <Button
                  icon={Redo}
                  class={HISTORY}
                  title="Redo"
                  aria-label="Redo"
                  disabled={!hist || hist.future.length === 0}
                  onClick={() => setHist((h) => (h ? history.redo(h) : h))}
                />
              </ButtonGroup>
              <Button
                variant="primary"
                icon={Save}
                class={HISTORY}
                title={saving ? "Saving…" : "Save"}
                aria-label={saving ? "Saving…" : "Save"}
                disabled={!dirty || saving}
                onClick={save}
              />
            </>
          }
          folder={project?.folder ?? ""}
          media={media}
          available={available}
          sync={sync}
          edit={edit}
          peaks={peaks}
          warnings={plan?.warnings ?? []}
          outputSeconds={plan?.duration_s ?? null}
          dirty={dirty}
          ready={ready}
          onEdit={onEdit}
          onRelinked={onRelinked}
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

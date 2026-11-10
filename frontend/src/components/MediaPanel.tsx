import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { setAudioIncluded, setEnabled } from "../lib/editOps";
import {
  addMedia,
  fetchMediaDetails,
  removeMedia,
  startProxies,
  thumbUrl,
  type EditList,
  type Job,
  type MediaDetails,
  type MediaItem,
  type Peaks,
  type SyncResult,
  type SyncState,
} from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { detailSections } from "../lib/mediaInfo";
import { channelsOf, groupMedia, trackIncluded, type MediaGroup } from "../lib/timeline";
import { channelStyle } from "../lib/channelStyle";
import { LibraryBrowser } from "./LibraryBrowser";
import { Button, Progress } from "./ui";
import { Icon } from "./Icon";
import {
  CaretDown,
  CaretRight,
  Close,
  Eye,
  EyeInvisible,
  InfoCircle,
  Plus,
  Sound,
  Thunderbolt,
  Warning,
} from "./icons";

interface Props {
  slug: string;
  /** The project's media. */
  media: MediaItem[];
  /** Everything in the project folder: the project's media plus files not included yet. */
  available: MediaItem[];
  sync: SyncState | null;
  peaks: Record<string, Peaks>;
  edit: EditList;
  onEdit: (edit: EditList) => void;
  onChange: () => void;
  onError: (message: string) => void;
}

const CARD = "w-[7.25rem]"; // slightly bigger than the grid's tiles' smallest, still small-ish

/** The media tab: every file of the project folder as a card, grouped by folder. */
export function MediaPanel(props: Props) {
  const { slug, media, available, sync, peaks, edit, onEdit, onChange, onError } = props;
  const [browsing, setBrowsing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ item: MediaItem; rect: DOMRect } | null>(null);
  const noProxy = media.filter((m) => !m.proxy_ready && !m.missing).length;
  const numbers = useMemo(
    () => new Map(channelsOf(media, edit.disabled).map((c) => [c.item.id, c.number])),
    [media, edit.disabled],
  );
  const groups = useMemo(() => groupMedia(available), [available]);

  const fail = (e: unknown) => onError(e instanceof Error ? e.message : String(e));

  const add = async (paths: string[]) => {
    setBrowsing(false);
    try {
      for (const path of paths) await addMedia(slug, path);
    } catch (e) {
      fail(e);
    }
    onChange();
  };

  const buildProxies = async () => {
    try {
      const started = await startProxies(slug);
      setJob(started);
      const done = await waitForJob(started.id, setJob);
      if (done.state === "error") onError(done.error ?? "proxy build failed");
    } catch (e) {
      fail(e);
    }
    setJob(null);
    onChange();
  };

  const toggleFolder = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div class="flex h-full gap-4">
      <div class="flex shrink-0 flex-col items-start gap-2">
        <Button variant="primary" icon={Plus} onClick={() => setBrowsing(true)}>
          Add media…
        </Button>
        <Button icon={Thunderbolt} disabled={noProxy === 0 || job !== null} onClick={buildProxies}>
          Build proxies{noProxy ? ` (${noProxy})` : ""}
        </Button>
        {job && <Progress value={job.progress} label={job.message} />}
      </div>
      {available.length === 0 ? (
        <p class="self-center text-sm text-neutral-500">
          No media yet. Put the camera and audio files from this session in the project&apos;s
          folder (subfolders are fine) and they show up here, or add files from elsewhere.
        </p>
      ) : (
        <div
          class="flex min-w-0 flex-1 items-start gap-4 overflow-x-auto"
          data-testid="media-groups"
        >
          {groups.map((g) => (
            <FolderGroup
              key={g.key}
              group={g}
              collapsed={collapsed.has(g.key)}
              onToggle={() => toggleFolder(g.key)}
            >
              {g.items.map((m) => (
                <MediaCard
                  key={m.id}
                  slug={slug}
                  item={m}
                  media={media}
                  edit={edit}
                  number={numbers.get(m.id) ?? null}
                  syncResult={sync?.results[m.id] ?? null}
                  peaks={peaks[m.id] ?? null}
                  onEdit={onEdit}
                  onInclude={() => add([m.path])}
                  onDetails={(rect) => setOpen({ item: m, rect })}
                />
              ))}
            </FolderGroup>
          ))}
        </div>
      )}
      {open && (
        <DetailsPopover
          slug={slug}
          item={open.item}
          rect={open.rect}
          edit={edit}
          syncResult={sync?.results[open.item.id] ?? null}
          onRemove={() => {
            const id = open.item.id;
            setOpen(null);
            removeMedia(slug, id).then(onChange, fail);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {browsing && <LibraryBrowser onAdd={add} onClose={() => setBrowsing(false)} />}
    </div>
  );
}

/** One folder of the hierarchy: a header you can fold, and its cards in two rows. */
function FolderGroup({
  group,
  collapsed,
  onToggle,
  children,
}: {
  group: MediaGroup;
  collapsed: boolean;
  onToggle: () => void;
  children: preact.ComponentChildren;
}) {
  const name = group.external
    ? `Elsewhere${group.title ? ` · ${group.title}` : ""}`
    : group.title || "Project folder";
  return (
    <section class="flex shrink-0 flex-col gap-1" data-testid="media-folder" aria-label={name}>
      <button
        type="button"
        class="flex items-center gap-1 text-left text-[11px] leading-4 text-neutral-400 hover:text-neutral-200"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <Icon icon={collapsed ? CaretRight : CaretDown} />
        <span class="max-w-[16rem] truncate">{name}</span>
        <span class="text-neutral-600">({group.items.length})</span>
      </button>
      {!collapsed && (
        <ul class="grid auto-cols-[7.25rem] grid-flow-col grid-rows-2 gap-1.5">{children}</ul>
      )}
    </section>
  );
}

const SYNC_DOT: Record<SyncResult["status"] | "none", { tone: string; label: string }> = {
  synced: { tone: "bg-emerald-400", label: "synced" },
  low_confidence: { tone: "bg-amber-400", label: "low confidence" },
  unsynced: { tone: "bg-red-400", label: "not found" },
  none: { tone: "bg-neutral-500", label: "not synced yet" },
};

function MediaCard({
  slug,
  item: m,
  media,
  edit,
  number,
  syncResult,
  peaks,
  onEdit,
  onInclude,
  onDetails,
}: {
  slug: string;
  item: MediaItem;
  media: MediaItem[];
  edit: EditList;
  number: number | null;
  syncResult: SyncResult | null;
  peaks: Peaks | null;
  onEdit: (edit: EditList) => void;
  onInclude: () => void;
  onDetails: (rect: DOMRect) => void;
}) {
  const included = m.included;
  const audio = m.kind === "audio";
  const disabled = edit.disabled.includes(m.id);
  // The one on/off control: shown in the grid and timeline for cameras and stills; for an audio
  // file it is whether its sound is in the output.
  const on = !included ? false : audio ? trackIncluded(edit, media, m.id) : !disabled;
  const label = !included
    ? `Include ${m.label} in the project`
    : audio
      ? `Use audio from ${m.label}`
      : `Show ${m.label} in the grid`;
  const title = !included
    ? "Not in the project yet: click to include it"
    : audio
      ? on
        ? "This audio is in the output (click to leave it out)"
        : "This audio is left out of the output (click to use it)"
      : on
        ? "Shown in the playback grid and timeline (click to hide)"
        : "Hidden from the grid and timeline unless a segment uses it (click to show)";
  const toggle = () => {
    if (!included) onInclude();
    else if (audio) onEdit(setAudioIncluded(edit, media, m.id, !on));
    else onEdit(setEnabled(edit, m.id, disabled));
  };
  const showsAudioToggle = included && m.kind === "video" && m.has_audio;
  const sync = SYNC_DOT[syncResult?.status ?? "none"];
  const syncable = included && !m.missing && m.kind !== "image";
  const colour = channelStyle(m.kind === "image" ? "image" : "video").chip.split(" ")[0];
  const iconButton =
    "rounded bg-black/60 p-0.5 text-sm text-neutral-200 hover:bg-black/80 hover:text-white";

  return (
    <li
      class={`group relative aspect-video ${CARD} overflow-hidden rounded bg-neutral-900`}
      data-testid="media-card"
      data-included={included}
    >
      <div
        class={`h-full w-full ${on || audio ? "" : "opacity-45"} ${included ? "" : "opacity-60"}`}
      >
        <Picture_ slug={slug} item={m} peaks={peaks} />
      </div>
      {m.missing && (
        <div class="absolute inset-0 flex items-center justify-center bg-red-950/80 px-1 text-center text-[11px] text-red-200">
          Can&apos;t read this file
        </div>
      )}
      {included && number !== null && on && (
        <span
          class={`absolute left-1 top-1 rounded px-1.5 text-[11px] font-semibold text-white ${colour}`}
        >
          {number}
        </span>
      )}
      {!included && (
        <span class="absolute left-1 top-1 rounded bg-amber-500 px-1.5 text-[10px] font-semibold uppercase text-black">
          new
        </span>
      )}
      <div class="absolute right-1 top-1 flex gap-0.5">
        <button
          type="button"
          class={iconButton}
          aria-label={`Details for ${m.label}`}
          title="Details"
          onClick={(e) => onDetails((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          <Icon icon={InfoCircle} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          title={title}
          class={`${iconButton} ${on ? "text-sky-300" : ""}`}
          onClick={toggle}
        >
          <Icon icon={on ? Eye : EyeInvisible} />
        </button>
      </div>
      <div class="absolute bottom-0.5 right-1 flex items-center gap-1">
        {showsAudioToggle && (
          <label
            class={`${iconButton} cursor-pointer ${trackIncluded(edit, media, m.id) ? "text-sky-300" : "text-neutral-400"}`}
            title="Use this camera's own audio in the output (normally discarded)"
          >
            <input
              type="checkbox"
              class="sr-only"
              aria-label={`Use audio from ${m.label}`}
              checked={trackIncluded(edit, media, m.id)}
              onChange={(e) => onEdit(setAudioIncluded(edit, media, m.id, e.currentTarget.checked))}
            />
            <Icon icon={Sound} />
          </label>
        )}
        {syncable && (
          <span
            role="img"
            aria-label={`Sync: ${sync.label}`}
            title={`Sync: ${sync.label}${syncResult?.score ? ` (match ${syncResult.score.toFixed(2)})` : ""}`}
            class={`h-2.5 w-2.5 rounded-full ring-1 ring-black/60 ${sync.tone}`}
          />
        )}
        {included && !m.proxy_ready && !m.missing && m.kind !== "image" && (
          <Icon icon={Thunderbolt} class="text-xs text-amber-400" />
        )}
      </div>
      <span
        class={`absolute bottom-0 left-0 truncate rounded-tr bg-neutral-950/65 px-1.5 text-[11px] leading-4 text-neutral-100 ${showsAudioToggle ? "max-w-[55%]" : "max-w-[75%]"}`}
        title={m.path}
      >
        {m.label}
      </span>
    </li>
  );
}

/** What a card shows: the thumbnail, or for audio a little waveform. */
function Picture_({ slug, item, peaks }: { slug: string; item: MediaItem; peaks: Peaks | null }) {
  if (item.kind === "audio") return <Spark peaks={peaks} />;
  return (
    <img src={thumbUrl(slug, item.id)} alt="" loading="lazy" class="h-full w-full object-cover" />
  );
}

/** A few dozen bars of an audio file's loudness (it has no picture). */
function Spark({ peaks }: { peaks: Peaks | null }) {
  const bars = useMemo(() => {
    if (!peaks || peaks.values.length === 0) return [];
    const count = 56;
    const step = peaks.values.length / count;
    return Array.from({ length: count }, (_, i) => {
      const slice = peaks.values.slice(
        Math.floor(i * step),
        Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1),
      );
      return Math.max(...slice) / 255;
    });
  }, [peaks]);
  return (
    <div class="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-600">
      {bars.length === 0 ? (
        <Icon icon={Sound} class="text-2xl" />
      ) : (
        <svg viewBox={`0 0 ${bars.length} 100`} preserveAspectRatio="none" class="h-3/5 w-[92%]">
          {bars.map((b, i) => (
            <rect
              key={i}
              x={i + 0.15}
              y={50 - b * 50}
              width={0.7}
              height={Math.max(b * 100, 2)}
              fill="#a3b0c2"
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/** Technical details of one file, in a pop-up over the page (so the ribbon can't clip it). */
function DetailsPopover({
  slug,
  item,
  rect,
  edit,
  syncResult,
  onRemove,
  onClose,
}: {
  slug: string;
  item: MediaItem;
  rect: DOMRect;
  edit: EditList;
  syncResult: SyncResult | null;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetchMediaDetails(slug, item.id).then(
      (d) => live && setDetails(d),
      (e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [slug, item.id]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const projectFps = edit.fps_den ? { fps: edit.fps_num / edit.fps_den } : null;
  const width = 288;
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
  const sections = details ? detailSections(details, item, projectFps) : [];

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`Details for ${item.label}`}
      class="fixed z-50 max-h-[calc(100vh-8rem)] w-72 overflow-y-auto rounded border border-neutral-600 bg-neutral-900 p-3 text-xs shadow-xl"
      style={{ left, top: rect.bottom + 6 }}
    >
      <div class="mb-1 flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-neutral-100">{item.label}</div>
          <div class="break-all text-[11px] text-neutral-500">{item.path}</div>
        </div>
        <button
          class="text-neutral-500 hover:text-neutral-200"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon icon={Close} />
        </button>
      </div>
      {problem && <p class="mt-2 text-red-300">{problem}</p>}
      {!details && !problem && <p class="mt-2 text-neutral-500">Reading the file…</p>}
      {sections.map((s) => (
        <div key={s.title} class="mt-2">
          <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            {s.title}
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {s.rows.map((r) => (
              <>
                <dt class="text-neutral-400">{r.label}</dt>
                <dd class={r.warn ? "text-amber-300" : "text-neutral-100"}>
                  {r.warn && <Icon icon={Warning} class="mr-1" />}
                  {r.value}
                </dd>
              </>
            ))}
          </dl>
        </div>
      ))}
      <div class="mt-2">
        <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
          In this project
        </div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt class="text-neutral-400">Status</dt>
          <dd>{item.included ? "included" : "found in the folder, not included yet"}</dd>
          {item.kind !== "image" && item.included && (
            <>
              <dt class="text-neutral-400">Proxy</dt>
              <dd>{item.proxy_ready ? "built" : "not built yet"}</dd>
              <dt class="text-neutral-400">Sync</dt>
              <dd>
                {syncResult
                  ? `${SYNC_DOT[syncResult.status].label}${syncResult.start_s !== null ? `, starts at ${syncResult.start_s.toFixed(3)} s` : ""}`
                  : "not synced yet"}
              </dd>
            </>
          )}
        </dl>
      </div>
      {item.included && (
        <div class="mt-3 border-t border-neutral-700 pt-2">
          <Button variant="ghost" icon={Close} onClick={onRemove}>
            Remove from project
          </Button>
          <p class="mt-1 text-[11px] text-neutral-500">The file itself is not touched.</p>
        </div>
      )}
    </div>
  );
}

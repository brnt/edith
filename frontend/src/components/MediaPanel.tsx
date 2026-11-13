import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { setAllEnabled, setAudioIncluded, setEnabled } from "../lib/editOps";
import {
  fetchMediaDetails,
  includeMedia,
  relinkMedia,
  startSync,
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
import {
  detailSections,
  formatNotes,
  matchesFilter,
  type MediaFilter,
  type ProjectFormat,
} from "../lib/mediaInfo";
import {
  channelsOf,
  defaultCamera,
  groupMedia,
  mediaOffsets,
  segments,
  timelineEnd,
  trackIncluded,
  type MediaGroup,
} from "../lib/timeline";
import { channelStyle } from "../lib/channelStyle";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";
import { Button, Select } from "./ui";
import { RibbonButton, RibbonCell, RibbonGroup, RibbonProgress, RibbonSet } from "./RibbonGrid";
import { Icon } from "./Icon";
import {
  AddAll,
  CaretDown,
  CaretRight,
  CheckCircle,
  Close,
  CloseCircle,
  ExclamationCircle,
  InfoCircle,
  Loading,
  Picture,
  RemoveAll,
  Sound,
  Speaker,
  SpeakerMuted,
  Sync,
  Thunderbolt,
  VideoCamera,
  Warning,
} from "./icons";

interface Props {
  slug: string;
  /** The project's folder (absolute): where its media goes. */
  folder: string;
  /** The project's media. */
  media: MediaItem[];
  /** Everything in the project folder: the project's media plus files not included yet. */
  available: MediaItem[];
  sync: SyncState | null;
  peaks: Record<string, Peaks>;
  edit: EditList;
  onEdit: (edit: EditList) => void;
  /** A missing file was relinked: the id that named it is now the new one. */
  onRelinked: (from: string, to: string) => void;
  onChange: () => void;
  onError: (message: string) => void;
}

/** What kind a card is, at a glance: an icon and a tint on the name chip (and the number chip's colour). */
const KIND = {
  video: { icon: VideoCamera, tint: "bg-sky-950/85", name: "Camera" },
  image: { icon: Picture, tint: "bg-teal-950/85", name: "Still" },
  audio: { icon: Sound, tint: "bg-neutral-900/85", name: "Audio" },
} as const;

const CARD = "w-[7.25rem]"; // slightly bigger than the grid's tiles' smallest, still small-ish

/** The media tab: every file of the project folder as a card, grouped by folder. */
export function MediaPanel(props: Props) {
  const {
    slug,
    folder,
    media,
    available,
    sync,
    peaks,
    edit,
    onEdit,
    onRelinked,
    onChange,
    onError,
  } = props;
  // A missing file being pointed at another: the browser opens to choose the new one.
  const [relinking, setRelinking] = useState<MediaItem | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ item: MediaItem; rect: DOMRect } | null>(null);
  const preparing = available.filter((m) => m.proxy_building).length;
  const numbers = useMemo(
    () => new Map(channelsOf(media, edit.disabled).map((c) => [c.item.id, c.number])),
    [media, edit.disabled],
  );
  const [filter, setFilter] = useState<MediaFilter>("all");
  const groups = useMemo(
    () => groupMedia(available.filter((m) => matchesFilter(m, filter, sync))),
    [available, filter, sync],
  );
  const projectFps = edit.fps_den
    ? { fps: edit.fps_num / edit.fps_den, width: edit.width, height: edit.height }
    : null;
  // How many segments of the edit show each camera or still.
  const usage = useMemo(() => {
    const offsets = mediaOffsets(media, sync);
    const counts = new Map<string, number>();
    for (const seg of segments(
      edit.switches,
      defaultCamera(media, offsets),
      timelineEnd(media, offsets),
    )) {
      if (seg.channel && seg.end > seg.start)
        counts.set(seg.channel, (counts.get(seg.channel) ?? 0) + 1);
    }
    return counts;
  }, [media, sync, edit.switches]);

  const fail = (e: unknown) => onError(e instanceof Error ? e.message : String(e));

  /** Including a file is the edit that writes it into the project (looking never does). */
  const include = async (paths: string[]) => {
    try {
      for (const path of paths) await includeMedia(slug, path);
    } catch (e) {
      fail(e);
    }
    onChange();
  };

  const relink = async (item: MediaItem, path: string) => {
    setRelinking(null);
    try {
      const moved = await relinkMedia(slug, item.id, path);
      onRelinked(item.id, moved.id);
    } catch (e) {
      fail(e);
    }
    onChange();
  };

  /** A file turned up in the folder with this one's name and length: probably it moved. */
  const suggestionFor = (m: MediaItem) =>
    m.missing
      ? (available.find(
          (a) =>
            !a.included &&
            !a.missing &&
            a.kind === m.kind &&
            a.label === m.label &&
            Math.abs((a.duration_s ?? 0) - (m.duration_s ?? 0)) < 0.1,
        ) ?? null)
      : null;

  /** Search every file for this audio file's sound: the same sync the Sync tab runs. */
  const useAsRegistrationSound = async (item: MediaItem) => {
    setOpen(null);
    try {
      const started = await startSync(slug, { kind: "file", path: item.path });
      setJob(started);
      const done = await waitForJob(started.id, setJob);
      if (done.state === "error") onError(done.error ?? "sync failed");
    } catch (e) {
      fail(e);
    }
    setJob(null);
    onChange();
  };

  // What the buttons under the filter act on: the project's files that the filter lists. Add all
  // turns them all on; Exclude unused switches off the cameras and stills no segment shows.
  const shownHere = groups.flatMap((g) => g.items).filter((m) => m.included);
  const isOn = (m: MediaItem) =>
    m.kind === "audio" ? trackIncluded(edit, media, m.id) : !edit.disabled.includes(m.id);
  const nothingHidden = shownHere.every(isOn);
  const unusedHere = shownHere.filter(
    (m) => m.kind !== "audio" && isOn(m) && (usage.get(m.id) ?? 0) === 0,
  );

  const rootName = folder.split("/").filter(Boolean).pop() ?? "Project folder";

  const toggleFolder = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div class="flex h-full gap-4">
      {available.length > 0 && (
        <RibbonGroup
          title={
            preparing > 0 ? (
              <span
                class="flex items-center justify-center gap-1"
                title="Low-resolution previews are made in the background as media is found"
                data-testid="preparing"
              >
                <Icon icon={Loading} class="animate-spin" />
                Previews ({preparing})
              </span>
            ) : (
              "View"
            )
          }
        >
          <RibbonSet columns={4}>
            <RibbonCell columns={4}>
              <Select
                block
                aria-label="Show"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value as MediaFilter)}
              >
                <option value="all">All files</option>
                <option value="video">Cameras</option>
                <option value="audio">Audio</option>
                <option value="image">Stills</option>
                <option value="new">New (not included)</option>
                <option value="unsynced">Not synced</option>
              </Select>
            </RibbonCell>
            <RibbonButton
              size={2}
              label="Add all"
              text="Add all"
              icon={AddAll}
              disabled={nothingHidden}
              onClick={() => onEdit(setAllEnabled(edit, media, shownHere, true))}
            />
            <RibbonButton
              size={2}
              label="Exclude unused"
              text="Unused"
              icon={RemoveAll}
              disabled={unusedHere.length === 0}
              onClick={() => onEdit(setAllEnabled(edit, media, unusedHere, false))}
            />
            {job && <RibbonProgress columns={4} value={job.progress} label={job.message} />}
          </RibbonSet>
        </RibbonGroup>
      )}
      {available.length === 0 ? (
        <p class="self-center text-sm text-neutral-500">
          No media yet. Drop the camera and audio files from this session into the project folder
          {folder ? ` (${folder})` : ""}, subfolders included, and they show up here by themselves.
        </p>
      ) : groups.length === 0 ? (
        <p class="self-center text-sm text-neutral-500">Nothing matches this filter.</p>
      ) : (
        <div
          class="flex min-w-0 flex-1 items-start gap-4 overflow-x-auto"
          data-testid="media-groups"
        >
          {groups.map((g) => (
            <FolderGroup
              key={g.key}
              group={g}
              rootName={rootName}
              collapsed={collapsed.has(g.key)}
              onToggle={() => toggleFolder(g.key)}
              onIncludeAll={() => include(g.items.filter((m) => !m.included).map((m) => m.path))}
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
                  projectFps={projectFps}
                  suggestion={suggestionFor(m)}
                  onRelink={(path) => (path ? relink(m, path) : setRelinking(m))}
                  onEdit={onEdit}
                  onInclude={() => include([m.path])}
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
          projectFps={projectFps}
          usedIn={usage.get(open.item.id) ?? 0}
          onUseAsSound={() => useAsRegistrationSound(open.item)}
          syncResult={sync?.results[open.item.id] ?? null}
          onClose={() => setOpen(null)}
        />
      )}
      {relinking && (
        <RelinkPicker
          item={relinking}
          candidates={available.filter(
            (a) => !a.included && !a.missing && a.kind === relinking.kind,
          )}
          onPick={(path) => relink(relinking, path)}
          onClose={() => setRelinking(null)}
        />
      )}
    </div>
  );
}

/** One folder of the hierarchy: a header you can fold, and its cards in two rows. */
function FolderGroup({
  group,
  rootName,
  collapsed,
  onToggle,
  onIncludeAll,
  children,
}: {
  group: MediaGroup;
  /** What the files directly in the project folder are called: the folder's own name. */
  rootName: string;
  collapsed: boolean;
  onToggle: () => void;
  onIncludeAll: () => void;
  children: preact.ComponentChildren;
}) {
  const waiting = group.items.filter((m) => !m.included).length;
  const name = group.title || rootName;
  return (
    <section class="flex shrink-0 flex-col gap-1" data-testid="media-folder" aria-label={name}>
      <div class="flex items-center gap-2 text-[11px] leading-4">
        <button
          type="button"
          class="flex min-w-0 items-center gap-1 text-left text-neutral-400 hover:text-neutral-200"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <Icon icon={collapsed ? CaretRight : CaretDown} />
          <span class="max-w-[16rem] truncate">{name}</span>
          <span class="text-neutral-600">({group.items.length})</span>
        </button>
        {waiting > 0 && (
          <button
            type="button"
            class="text-amber-300 hover:text-amber-200"
            onClick={onIncludeAll}
            title="Include every new file of this folder in the project"
          >
            Include {waiting === group.items.length ? "all" : `${waiting} new`}
          </button>
        )}
      </div>
      {!collapsed && (
        <ul class="grid auto-cols-[7.25rem] grid-flow-col grid-rows-2 gap-1.5">{children}</ul>
      )}
    </section>
  );
}

const SYNC_DOT: Record<
  SyncResult["status"] | "none",
  { icon: IconDefinition; tone: string; label: string }
> = {
  synced: { icon: CheckCircle, tone: "text-emerald-400", label: "synced" },
  low_confidence: { icon: ExclamationCircle, tone: "text-amber-400", label: "low confidence" },
  unsynced: { icon: CloseCircle, tone: "text-red-400", label: "not found" },
  none: { icon: Sync, tone: "text-neutral-400", label: "not synced yet" },
};

function MediaCard({
  slug,
  item: m,
  media,
  edit,
  number,
  syncResult,
  peaks,
  projectFps,
  suggestion,
  onRelink,
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
  projectFps: ProjectFormat | null;
  suggestion: MediaItem | null;
  /** With a path: use that file; without: choose one. */
  onRelink: (path?: string) => void;
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
  const notes = formatNotes(m, projectFps);
  const syncable = included && !m.missing && m.kind !== "image";
  const colour = channelStyle(m.kind === "image" ? "image" : "video").chip.split(" ")[0];
  // Icon chips (18px, with the same 4px gap in both rows and clear space between the rows): one square, centred by grid (the same whether it is a button, a label or a
  // span, which browsers centre differently), with no line height.
  const iconButton =
    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-black/60 p-0 text-[13px] leading-none text-neutral-200 hover:bg-black/80 hover:text-white";
  const kind = KIND[m.kind];

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
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/85 px-1 text-center text-[11px] text-red-200">
          Can&apos;t read this file
          {included && (
            <button
              type="button"
              class="rounded bg-red-800 px-1.5 text-[11px] text-white hover:bg-red-700"
              title={
                suggestion
                  ? `Use ${suggestion.path}, which has the same name and length`
                  : "Choose where the file is now"
              }
              onClick={() => onRelink(suggestion?.path)}
            >
              {suggestion ? "Use found file" : "Relink…"}
            </button>
          )}
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
      {/* The alert sits on the left, level with the second row of chips on the right (4 px edge + 18 px chip
          + 4 px gap), so the chips on the right keep the same order and positions whether or not it shows. */}
      {notes.length > 0 && (
        <button
          type="button"
          class={`${iconButton} absolute left-1 top-[26px] text-amber-300`}
          aria-label={notes.join(". ")}
          title={`${notes.join("\n")}\nClick for the details`}
          onClick={(e) => onDetails((e.currentTarget as HTMLElement).getBoundingClientRect())}
        >
          <Icon icon={Warning} />
        </button>
      )}
      {/* Both rows of chips in one column, so the space between rows equals the space between chips. */}
      <div class="absolute right-1 top-1 flex flex-col items-end gap-1">
        <div class="flex gap-1">
          <button
            type="button"
            class={iconButton}
            aria-label={`Details for ${m.label}`}
            title="Details"
            onClick={(e) => onDetails((e.currentTarget as HTMLElement).getBoundingClientRect())}
          >
            <Icon icon={InfoCircle} />
          </button>
          <label class={`${iconButton} cursor-pointer`} title={title}>
            <input
              type="checkbox"
              class="h-3.5 w-3.5 cursor-pointer accent-sky-400"
              aria-label={label}
              checked={on}
              onChange={toggle}
            />
          </label>
        </div>
        <div class="flex items-center gap-1">
          {showsAudioToggle && (
            <label
              class={`${iconButton} cursor-pointer ${trackIncluded(edit, media, m.id) ? "text-sky-300" : "text-neutral-300"}`}
              title="Use this camera's own audio in the output (normally discarded)"
            >
              <input
                type="checkbox"
                class="sr-only"
                aria-label={`Use audio from ${m.label}`}
                checked={trackIncluded(edit, media, m.id)}
                onChange={(e) =>
                  onEdit(setAudioIncluded(edit, media, m.id, e.currentTarget.checked))
                }
              />
              <Icon icon={trackIncluded(edit, media, m.id) ? Speaker : SpeakerMuted} />
            </label>
          )}
          {syncable && (
            <span
              role="img"
              aria-label={`Sync: ${sync.label}`}
              title={`Sync: ${sync.label}${syncResult?.score ? ` (match ${syncResult.score.toFixed(2)})` : ""}`}
              class={`${iconButton} ${sync.tone}`}
            >
              <Icon icon={sync.icon} />
            </span>
          )}
          {m.proxy_building && (
            <span class={`${iconButton} text-sky-300`} title="Preparing the preview…">
              <Icon icon={Loading} class="animate-spin" />
            </span>
          )}
          {!m.proxy_building && !m.proxy_ready && !m.missing && m.kind !== "image" && (
            <span class={`${iconButton} text-amber-400`} title="The preview couldn't be made">
              <Icon icon={Thunderbolt} />
            </span>
          )}
        </div>
      </div>
      <span
        class={`absolute bottom-0 left-0 inline-flex items-center gap-1 rounded-tr px-1.5 text-[11px] leading-4 text-neutral-100 ${kind.tint} max-w-[calc(100%-0.25rem)]`}
        title={`${kind.name}: ${m.path}`}
        data-testid="name-chip"
      >
        <Icon icon={kind.icon} class="text-[11px] opacity-80" />
        <span class="truncate">{m.label}</span>
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
  projectFps,
  usedIn,
  onUseAsSound,
  syncResult,
  onClose,
}: {
  slug: string;
  item: MediaItem;
  rect: DOMRect;
  projectFps: ProjectFormat | null;
  usedIn: number;
  onUseAsSound: () => void;
  syncResult: SyncResult | null;
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
              {item.kind !== "audio" && (
                <>
                  <dt class="text-neutral-400">Used</dt>
                  <dd>
                    {usedIn === 0
                      ? "not in any segment"
                      : `in ${usedIn} segment${usedIn === 1 ? "" : "s"}`}
                  </dd>
                </>
              )}
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
      {item.kind === "audio" && !item.missing && (
        <div class="mt-3 border-t border-neutral-700 pt-2">
          <Button icon={Sync} onClick={onUseAsSound}>
            Use as the registration sound
          </Button>
          <p class="mt-1 text-[11px] text-neutral-500">
            Finds this sound in every file and syncs them to it (the same as the Sync tab&apos;s
            &ldquo;An audio file&rdquo;).
          </p>
        </div>
      )}
    </div>
  );
}

/** Choose which file in the project folder a missing file has become. */
function RelinkPicker({
  item,
  candidates,
  onPick,
  onClose,
}: {
  item: MediaItem;
  candidates: MediaItem[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-label={`Relink ${item.label}`}
    >
      <div class="flex max-h-[70vh] w-[30rem] flex-col rounded border border-neutral-700 bg-neutral-900 p-4 text-sm">
        <h3 class="font-semibold">{item.label} can&apos;t be found</h3>
        <p class="mt-1 text-neutral-400">
          It was {item.path}. Put the file back in the project folder (or a subfolder), or pick the
          file it has become:
        </p>
        <ul class="mt-2 flex-1 space-y-1 overflow-y-auto">
          {candidates.map((c) => (
            <li key={c.path}>
              <button class="text-sky-300 hover:text-sky-200" onClick={() => onPick(c.path)}>
                {c.path}
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li class="text-neutral-500">No other {item.kind} files in the project folder yet.</li>
          )}
        </ul>
        <div class="mt-3 flex justify-end">
          <Button variant="ghost" icon={Close} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

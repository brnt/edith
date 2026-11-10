import { useState } from "preact/hooks";

import {
  exportUrl,
  type EditList,
  type ExportFormat,
  type MediaItem,
  type Peaks,
  type SyncState,
} from "../lib/api";
import { useEditor } from "../lib/useEditor";
import { EditTools } from "./EditTools";
import { MediaPanel } from "./MediaPanel";
import { SyncStatus } from "./SyncStatus";
import { RenderPanel } from "./RenderPanel";
import { Ribbon } from "./Ribbon";
import { Stage } from "./Stage";
import { SyncPanel } from "./SyncPanel";
import { Badge } from "./ui";
import { Icon } from "./Icon";
import { Download, Export, Scissor, Sync, VideoCamera } from "./icons";

const FORMATS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "fcpxml", label: "Resolve / Final Cut", hint: "FCPXML: video + audio tracks" },
  { format: "xmeml", label: "Premiere", hint: "Premiere XML: video + audio tracks" },
  { format: "edl", label: "EDL", hint: "video cuts only" },
  { format: "json", label: "Edith JSON", hint: "all project data" },
];

type TabId = "media" | "sync" | "edit" | "export";

interface Props {
  slug: string;
  /** The project's media. */
  media: MediaItem[];
  /** Everything in the project folder, included or not (the media tab lists all of it). */
  available: MediaItem[];
  sync: SyncState | null;
  edit: EditList;
  peaks: Record<string, Peaks>;
  warnings: string[];
  outputSeconds: number | null;
  dirty: boolean;
  ready: boolean;
  onEdit: (edit: EditList) => void;
  /** A media item was relinked to a different file: its old id is now the new one. */
  onRelinked: (from: string, to: string) => void;
  onMediaChange: () => void;
  onSyncChange: () => void;
  onError: (message: string) => void;
}

/** The tool ribbon (fixed height, one tab at a time) over the always-visible stage. */
export function Studio(props: Props) {
  const { slug, media, sync, edit, dirty } = props;
  const ed = useEditor({
    slug,
    media,
    sync,
    edit,
    onEdit: props.onEdit,
    onError: props.onError,
    ready: props.ready,
  });
  const [chosen, setChosen] = useState<TabId | null>(null);

  const synced = sync !== null && Object.keys(sync.results).length > 0;
  const newFiles = props.available.filter((m) => !m.included && !m.missing).length;
  const unsynced = media.filter(
    (m) => m.kind !== "image" && m.has_audio && !sync?.results[m.id],
  ).length;
  // Until the user picks a tab, open the one that is the next step.
  const next: TabId = !props.ready
    ? "edit"
    : media.length === 0
      ? "media"
      : !synced
        ? "sync"
        : "edit";
  const active = chosen ?? next;

  return (
    <>
      <Ribbon
        active={active}
        onSelect={(id) => setChosen(id as TabId)}
        tabs={[
          {
            id: "media",
            label: `Media (${media.length})`,
            icon: VideoCamera,
            // Files that turned up in the project folder, waiting to be included.
            badge: newFiles ? <Badge tone="warn">{newFiles} new</Badge> : undefined,
          },
          {
            id: "sync",
            label: "Sync",
            icon: Sync,
            badge: synced ? <SyncStatus complete={!unsynced} /> : undefined,
          },
          { id: "edit", label: "Edit", icon: Scissor },
          { id: "export", label: "Export", icon: Export },
        ]}
      >
        {active === "media" && (
          <MediaPanel
            slug={slug}
            media={media}
            available={props.available}
            sync={sync}
            peaks={props.peaks}
            edit={edit}
            onEdit={props.onEdit}
            onRelinked={props.onRelinked}
            onChange={props.onMediaChange}
            onError={props.onError}
          />
        )}
        {active === "sync" && (
          <SyncPanel
            slug={slug}
            media={media}
            sync={sync}
            peaks={props.peaks}
            onChange={props.onSyncChange}
            onError={props.onError}
          />
        )}
        {active === "edit" && <EditTools ed={ed} />}
        {active === "export" && (
          <div class="flex h-full gap-3 text-sm">
            <div class="flex shrink-0 flex-col justify-between border-r border-neutral-700 pr-3">
              <div class="flex flex-wrap items-center gap-2">
                {FORMATS.map((f) => (
                  <a
                    key={f.format}
                    href={exportUrl(slug, f.format)}
                    download
                    title={f.hint}
                    class={`inline-flex items-center gap-1.5 rounded px-3 py-1 ${
                      dirty
                        ? "pointer-events-none bg-neutral-800 text-neutral-600"
                        : "bg-neutral-700 text-neutral-100 hover:bg-neutral-600"
                    }`}
                  >
                    <Icon icon={Download} />
                    {f.label}
                  </a>
                ))}
              </div>
              <div class="pt-1 text-center text-[10px] uppercase tracking-wide text-neutral-500">
                Export the saved edit
              </div>
            </div>
            <div class="flex flex-1 flex-col justify-between">
              <div class="flex flex-wrap items-center gap-2">
                <RenderPanel
                  slug={slug}
                  disabled={dirty || !props.outputSeconds}
                  onError={props.onError}
                />
              </div>
              <div class="pt-1 text-[10px] uppercase tracking-wide text-neutral-500">
                {dirty ? "Save your changes first. " : ""}
                {props.outputSeconds ? `Output length ${Math.round(props.outputSeconds)} s` : ""}
              </div>
            </div>
          </div>
        )}
      </Ribbon>
      <Stage slug={slug} ed={ed} peaks={props.peaks} warnings={props.warnings} />
    </>
  );
}

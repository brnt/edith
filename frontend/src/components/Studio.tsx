import type { ComponentChildren } from "preact";
import type { IconDefinition } from "@ant-design/icons-svg/es/types";
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
import { RibbonButton, RibbonGroup, RibbonSet } from "./RibbonGrid";
import { Braces, Edit, Export, ListNumbers, Premiere, Resolve, Sync, VideoCamera } from "./icons";

/** Each export has the icon of its format's program (or of the format itself): none is used twice in the ribbon. */
const FORMATS: {
  format: ExportFormat;
  label: string;
  word: string;
  hint: string;
  icon: IconDefinition;
}[] = [
  {
    format: "fcpxml",
    label: "Resolve / Final Cut",
    word: "Resolve",
    hint: "FCPXML, video + audio tracks",
    icon: Resolve,
  },
  {
    format: "xmeml",
    label: "Premiere",
    word: "Premiere",
    hint: "Premiere XML, video + audio tracks",
    icon: Premiere,
  },
  { format: "edl", label: "EDL", word: "EDL", hint: "video cuts only", icon: ListNumbers },
  { format: "json", label: "Edith JSON", word: "JSON", hint: "all project data", icon: Braces },
];

type TabId = "media" | "sync" | "edit" | "export";

interface Props {
  /** Undo, redo and save: shown at the right of the ribbon's tab strip. */
  actions?: ComponentChildren;
  slug: string;
  /** The project's folder (absolute), where its media goes. */
  folder: string;
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
        actions={props.actions}
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
          { id: "edit", label: "Edit", icon: Edit },
          { id: "export", label: "Export", icon: Export },
        ]}
      >
        {active === "media" && (
          <MediaPanel
            slug={slug}
            folder={props.folder}
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
            available={props.available}
            sync={sync}
            peaks={props.peaks}
            onChange={props.onSyncChange}
            onError={props.onError}
          />
        )}
        {active === "edit" && <EditTools ed={ed} />}
        {active === "export" && (
          <div class="flex h-full gap-3">
            <RibbonGroup title="Download">
              <RibbonSet columns={4}>
                {FORMATS.map((f) => (
                  <RibbonButton
                    key={f.format}
                    size={2}
                    icon={f.icon}
                    label={`${f.label}: ${f.hint}`}
                    text={f.word}
                    href={exportUrl(slug, f.format)}
                    download
                    disabled={dirty}
                  />
                ))}
              </RibbonSet>
            </RibbonGroup>
            <RenderPanel
              slug={slug}
              disabled={dirty || !props.outputSeconds}
              title={
                dirty
                  ? "Save first"
                  : props.outputSeconds
                    ? `Render · ${Math.round(props.outputSeconds)} s`
                    : "Render"
              }
              onError={props.onError}
            />
          </div>
        )}
      </Ribbon>
      <Stage
        slug={slug}
        ed={ed}
        peaks={props.peaks}
        warnings={props.warnings}
        onOpenMedia={() => setChosen("media")}
      />
    </>
  );
}

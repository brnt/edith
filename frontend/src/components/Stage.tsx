import { setTrack } from "../lib/editOps";
import type { Peaks } from "../lib/api";
import type { EditorApi } from "../lib/useEditor";
import { formatTime, timelineToOutput } from "../lib/timeline";
import { Player } from "./Player";
import { Timeline } from "./Timeline";
import { Button } from "./ui";

/** The part that is always on screen: the preview, transport, and the timeline. */
export function Stage({
  slug,
  ed,
  peaks,
  warnings,
}: {
  slug: string;
  ed: EditorApi;
  peaks: Record<string, Peaks>;
  warnings: string[];
}) {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div class="flex shrink-0 gap-4" style={{ height: "36vh", minHeight: 150 }}>
        <div class="aspect-video h-full shrink-0">
          <Player
            slug={slug}
            media={ed.media}
            offsets={ed.offsets}
            edit={ed.edit}
            t={ed.t}
            playing={ed.playing}
          />
        </div>
        <div class="flex min-w-0 flex-col justify-between text-sm">
          <div>
            <div class="font-mono text-2xl">{formatTime(ed.t, 2)}</div>
            <div class="text-xs text-neutral-500">
              output {formatTime(timelineToOutput(ed.t, ed.keeps), 2)} /{" "}
              {formatTime(ed.outputLength, 1)}
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" onClick={ed.togglePlay}>
                {ed.playing ? "Pause (space)" : "Play (space)"}
              </Button>
              <Button onClick={() => ed.setT(ed.lo)}>⏮ Start</Button>
            </div>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <Button onClick={() => ed.setZoom(Math.min(ed.pxPerSec * 1.5, 400))}>Zoom in</Button>
              <Button onClick={() => ed.setZoom(Math.max(ed.pxPerSec / 1.5, 1))}>Zoom out</Button>
              <Button disabled={ed.zoom === null} onClick={() => ed.setZoom(null)}>
                Fit
              </Button>
            </div>
            <div class="text-xs text-neutral-500">Click to place the playhead, drag to select.</div>
            {warnings.length > 0 && (
              <div class="truncate text-xs text-amber-300" title={warnings.join("\n")}>
                ⚠ {warnings[0]}
                {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={ed.timelineBox} class="min-h-0 flex-1 overflow-y-auto">
        <Timeline
          media={ed.media}
          offsets={ed.offsets}
          edit={ed.edit}
          peaks={peaks}
          playhead={ed.t}
          end={ed.end}
          pxPerSec={ed.pxPerSec}
          selection={ed.selection}
          suggestions={ed.suggestions}
          onSeek={ed.setT}
          onSelect={ed.setSelection}
          onCamera={ed.cutTo}
          onTrack={(id, patch) => ed.onEdit(setTrack(ed.edit, ed.media, id, patch))}
        />
      </div>
    </div>
  );
}

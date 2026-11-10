import type { Peaks } from "../lib/api";
import { setTrack } from "../lib/editOps";
import { formatTime, frameState, timelineToOutput } from "../lib/timeline";
import type { EditorApi } from "../lib/useEditor";
import { ChannelTiles } from "./ChannelTiles";
import { Icon } from "./Icon";
import { CaretRight, ColumnWidth, Pause, StepBackward, Warning, ZoomIn, ZoomOut } from "./icons";
import { Player } from "./Player";
import { Timeline } from "./Timeline";
import { Button } from "./ui";

// The active view's height; its width (16:9) and the column around it follow from this one value.
// It is 27vh at least, and grows with the window's height (what is left after the header, ribbon,
// transport and a usable timeline) until the view is two thirds of the window's width (37.5vw * 16/9).
const PLAYER_H = "clamp(140px, min(37.5vw, max(27vh, calc(100vh - 36rem))), 900px)";
// Room under the view for the time, the buttons, and one line of warning.
const BELOW_PLAYER = "5.5rem";

/** The part that is always on screen: the active view, the other cameras, transport, timeline. */
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
  const frame = frameState(ed.t, ed.edit, ed.media, ed.offsets);

  const zoom = (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={ZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => ed.setZoom(Math.min(ed.pxPerSec * 1.5, 400))}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={ZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => ed.setZoom(Math.max(ed.pxPerSec / 1.5, 1))}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={ColumnWidth}
        aria-label="Fit"
        title="Fit the whole timeline to the window"
        disabled={ed.zoom === null}
        onClick={() => ed.setZoom(null)}
      />
    </>
  );

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div class="flex shrink-0 gap-3" style={{ height: `calc(${PLAYER_H} + ${BELOW_PLAYER})` }}>
        <div
          class="flex h-full shrink-0 flex-col gap-1.5"
          style={{ width: `calc(${PLAYER_H} * 16 / 9)` }}
        >
          <div class="w-full shrink-0" style={{ height: PLAYER_H }}>
            <Player
              slug={slug}
              media={ed.media}
              offsets={ed.offsets}
              edit={ed.edit}
              t={ed.t}
              playing={ed.playing}
              elements={ed.mediaElements}
            />
          </div>
          <div class="flex shrink-0 items-center gap-3 text-sm">
            <div>
              <div class="font-mono text-xl leading-tight">{formatTime(ed.t, 2)}</div>
              <div class="text-xs text-neutral-500">
                output {formatTime(timelineToOutput(ed.t, ed.keeps), 2)} /{" "}
                {formatTime(ed.outputLength, 1)}
              </div>
            </div>
            <Button
              variant="primary"
              icon={ed.playing ? Pause : CaretRight}
              onClick={ed.togglePlay}
            >
              {ed.playing ? "Pause (space)" : "Play (space)"}
            </Button>
            <Button icon={StepBackward} onClick={() => ed.setT(ed.firstKept)}>
              Start
            </Button>
          </div>
          <div class="h-4 shrink-0">
            {warnings.length > 0 && (
              <div
                class="flex w-0 min-w-full items-center gap-1 truncate text-xs text-amber-300"
                title={warnings.join("\n")}
              >
                <Icon icon={Warning} />
                {warnings[0]}
                {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}
              </div>
            )}
          </div>
        </div>

        <ChannelTiles
          slug={slug}
          channels={ed.channels}
          activeId={frame.channel}
          elements={ed.mediaElements}
          local={frame.local}
          selection={ed.selection}
          onActivate={ed.cutTo}
        />
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
          corner={zoom}
          onSeek={ed.setT}
          onSelect={ed.setSelection}
          onCamera={ed.cutTo}
          onTrack={(id, patch) => ed.onEdit(setTrack(ed.edit, ed.media, id, patch))}
          picked={ed.picked}
          onPick={ed.pick}
          onSegmentEdge={ed.changeSegmentEdge}
          onScrub={ed.scrub}
          onCutChange={ed.changeCut}
        />
      </div>
    </div>
  );
}

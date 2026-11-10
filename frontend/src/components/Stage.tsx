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

// Vertical space is shared like this: the timeline takes what its rows need (it scrolls inside
// itself only when that would squeeze the view below its minimum), but never less than about four
// rows. The active view gets everything else, up to two thirds of the window's width (37.5 * 16/9).
const BELOW_PLAYER = "5.5rem"; // under the view: the time, the buttons, and one line of warning
const PLAYER_MIN = "max(140px, 27vh)"; // the smallest the view is squeezed to
const TIMELINE_MIN = "10.5rem"; // the ruler and four rows
// The view's height, measured against its own row (container query units): it fills the row, so it
// grows when the timeline is short.
const PLAYER_H = `clamp(140px, min(calc(100cqh - ${BELOW_PLAYER}), 37.5cqw), 900px)`;

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
  // While an edge is being dragged, show the result of dropping it now, not the old edit.
  const shown = ed.preview?.edit ?? ed.edit;
  const compare = ed.preview?.compare ?? null;
  const frame = frameState(ed.t, shown, ed.media, ed.offsets);

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
      <div
        class="flex min-h-0 flex-1 gap-3 [container-type:size]"
        style={{ minHeight: `calc(${PLAYER_MIN} + ${BELOW_PLAYER})`, "--player-h": PLAYER_H }}
      >
        <div
          class="flex h-full shrink-0 flex-col gap-1.5"
          style={{ width: compare ? "100%" : "calc(var(--player-h) * 16 / 9)" }}
        >
          <div class="w-full shrink-0" style={{ height: "var(--player-h)" }}>
            <Player
              slug={slug}
              media={ed.media}
              offsets={ed.offsets}
              edit={shown}
              compare={compare}
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

        {/* Hidden while two videos are compared side by side: they use the room. */}
        {!compare && (
          <ChannelTiles
            slug={slug}
            channels={ed.channels}
            activeId={frame.channel}
            elements={ed.mediaElements}
            local={frame.local}
            selection={ed.selection}
            onActivate={ed.cutTo}
          />
        )}
      </div>

      <div
        ref={ed.timelineBox}
        class="shrink-0 overflow-y-auto"
        style={{
          minHeight: TIMELINE_MIN,
          maxHeight: `calc(100% - ${PLAYER_MIN} - ${BELOW_PLAYER} - 0.5rem)`,
        }}
      >
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
          onPreview={ed.setPreview}
          onCutChange={ed.changeCut}
        />
      </div>
    </div>
  );
}

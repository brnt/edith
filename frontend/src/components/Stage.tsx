import { useEffect, useRef, useState } from "preact/hooks";

import type { Peaks } from "../lib/api";
import { setTrack } from "../lib/editOps";
import {
  formatTime,
  frameState,
  TIMELINE_MIN_PX,
  timelineBoxHeight,
  timelineToOutput,
} from "../lib/timeline";
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
const STAGE_PADDING_PX = 24; // p-3 top and bottom
const STAGE_GAP_PX = 8; // gap-2 between the view's row and the timeline
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
  const stage = useRef<HTMLDivElement>(null);
  // The timeline box's height, measured: all its rows if the view can spare the room, else what is
  // left. (Done in script, not CSS percentages, which browsers resolve differently in flex layouts.)
  const [boxH, setBoxH] = useState<number | null>(null);
  const measureRef = useRef<() => void>(() => {});
  useEffect(() => {
    const root = stage.current;
    const box = ed.timelineBox.current;
    const scroller = box?.firstElementChild as HTMLElement | null | undefined; // the timeline
    const rows = scroller?.firstElementChild as HTMLElement | null | undefined; // its content
    if (!root || !scroller || !rows || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const viewMin = Math.max(140, 0.27 * window.innerHeight) + 5.5 * rem;
      const room = root.clientHeight - STAGE_PADDING_PX - STAGE_GAP_PX - viewMin;
      // All of the rows, plus the scroller's own border (and a horizontal scrollbar when shown).
      const chrome = scroller.offsetHeight - scroller.clientHeight;
      const content = Math.max(rows.getBoundingClientRect().height, scroller.scrollHeight);
      const natural = Math.ceil(content + chrome);
      setBoxH(timelineBoxHeight(natural, room));
    };
    measureRef.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(rows);
    measure();
    return () => observer.disconnect();
  }, []);

  // Also after every render (a no-op when nothing changed): the observer alone can miss the moment
  // the rows first appear.
  useEffect(() => measureRef.current());

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
    <div ref={stage} class="flex min-h-0 flex-1 flex-col gap-2 p-3">
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
        class="shrink-0 overflow-hidden"
        style={{ height: boxH ?? undefined, minHeight: `${TIMELINE_MIN_PX}px` }}
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

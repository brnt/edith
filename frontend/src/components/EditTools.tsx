import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { addCuts, addMix, removeCut, removeMix, removeSwitch, setRange } from "../lib/editOps";
import { effectiveTracks, formatTime, type Range } from "../lib/timeline";
import type { EditorApi } from "../lib/useEditor";
import { Button, Dropdown } from "./ui";
import { Icon } from "./Icon";
import { AudioMuted, Check, Clear, Close, Scissor, Search, Sound } from "./icons";

/** A ribbon group: controls wrap within `width`, with the group's name underneath. */
function Group({
  title,
  width,
  column = false,
  children,
}: {
  title: string;
  width?: string;
  column?: boolean;
  children: ComponentChildren;
}) {
  return (
    <div
      class={`flex h-full shrink-0 flex-col justify-between border-r border-neutral-700 pr-3 text-sm ${width ?? ""}`}
    >
      <div
        class={`flex content-start gap-2 ${column ? "flex-col items-start" : "flex-wrap items-center"}`}
      >
        {children}
      </div>
      <div
        class="truncate pt-1 text-center text-[10px] uppercase tracking-wide text-neutral-500"
        title={title}
      >
        {title}
      </div>
    </div>
  );
}

interface Item {
  key: string;
  text: string;
  title?: string;
  onSeek: () => void;
  onRemove: () => void;
}

/** A menu of edit decisions: click one to jump to it, the cross to remove it. */
function ItemsMenu({ name, empty, items }: { name: string; empty: string; items: Item[] }) {
  return (
    <Dropdown label={`${name} (${items.length})`}>
      {items.length === 0 ? (
        <p class="text-neutral-500">{empty}</p>
      ) : (
        <ul class="space-y-1">
          {items.map((item) => (
            <li key={item.key} class="flex items-center justify-between gap-2">
              <button
                class="truncate text-left text-sky-300"
                title={item.title}
                onClick={item.onSeek}
              >
                {item.text}
              </button>
              <button
                class="text-neutral-500 hover:text-red-400"
                aria-label={`Remove ${item.text}`}
                onClick={item.onRemove}
              >
                <Icon icon={Close} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}

export function EditTools({ ed }: { ed: EditorApi }) {
  const { edit, media, onEdit, selection, silence, suggestions } = ed;
  const label = (id: string) => media.find((m) => m.id === id)?.label ?? id;
  // The mix applies to audio that is in the output.
  const outputTracks = effectiveTracks(edit, media).filter((t) => !t.muted);
  const [mixChoice, setMixChoice] = useState("");
  const [mixGain, setMixGain] = useState(-6);
  const mixTrack = outputTracks.some((t) => t.media_id === mixChoice)
    ? mixChoice
    : (outputTracks[0]?.media_id ?? "");
  const mixOver = (muted: boolean) => {
    if (!selection || !mixTrack) return;
    onEdit(
      addMix(edit, {
        media_id: mixTrack,
        start_s: selection[0],
        end_s: selection[1],
        gain_db: muted ? 0 : mixGain,
        muted,
      }),
    );
    ed.setSelection(null);
  };
  // Same numbering as the buttons, timeline rows, and number keys: cameras first, then stills.
  const channelName = (id: string | null) => {
    if (id === null) return "default camera";
    const channel = ed.channels.find((c) => c.item.id === id);
    if (!channel) return label(id);
    const n = channel.number;
    if (channel.item.kind === "video") return n ? `Camera ${n}` : channel.item.label;
    return n ? `Still ${n} · ${channel.item.label}` : channel.item.label;
  };

  const num = (key: keyof typeof silence, step: number) => (
    <input
      type="number"
      step={step}
      class="w-11 rounded bg-neutral-900 px-1 py-0.5"
      value={silence[key]}
      aria-label={key}
      onChange={(e) => ed.setSilence({ ...silence, [key]: Number(e.currentTarget.value) })}
    />
  );

  const selectionText = selection
    ? `${formatTime(selection[0], 2)} – ${formatTime(selection[1], 2)}`
    : "drag on the timeline";

  return (
    <div class="flex h-full gap-3">
      <Group title={`Selection: ${selectionText}`} width="w-52">
        <Button size="sm" icon={Scissor} disabled={!selection} onClick={ed.cutSelection}>
          Cut (x)
        </Button>
        <Button
          size="sm"
          icon={Check}
          disabled={!selection}
          onClick={() => {
            if (!selection) return;
            onEdit(setRange(edit, selection[0], selection[1]));
            ed.setSelection(null);
          }}
        >
          Keep only
        </Button>
      </Group>

      <Group title="Range" width="w-28">
        <Button size="sm" onClick={() => onEdit(setRange(edit, ed.t, edit.range_out_s))}>
          In (i)
        </Button>
        <Button size="sm" onClick={() => onEdit(setRange(edit, edit.range_in_s, ed.t))}>
          Out (o)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Clear}
          onClick={() => onEdit(setRange(edit, null, null))}
        >
          Clear
        </Button>
      </Group>

      <Group title="Mix the selection" width="w-44">
        <select
          class="w-full rounded bg-neutral-900 px-1 py-1"
          aria-label="Mix track"
          title="Which audio track to adjust"
          value={mixTrack}
          onChange={(e) => setMixChoice(e.currentTarget.value)}
        >
          {outputTracks.map((t) => (
            <option key={t.media_id} value={t.media_id}>
              {label(t.media_id)}
            </option>
          ))}
        </select>
        <input
          type="number"
          step={1}
          class="w-14 rounded bg-neutral-900 px-1 py-0.5"
          aria-label="Level change (dB)"
          value={mixGain}
          onChange={(e) => setMixGain(Number(e.currentTarget.value))}
        />
        <span>dB</span>
        <Button
          size="sm"
          icon={Sound}
          disabled={!selection || !mixTrack}
          onClick={() => mixOver(false)}
        >
          Set
        </Button>
        <Button
          size="sm"
          icon={AudioMuted}
          disabled={!selection || !mixTrack}
          onClick={() => mixOver(true)}
        >
          Mute
        </Button>
      </Group>

      <Group title="Dead time (uses saved range and tracks)" width="w-44">
        <label>&lt; {num("threshold", 1)} dB</label>
        <label>≥ {num("minS", 0.5)} s</label>
        <label>keep {num("pad", 0.1)} s</label>
        <Button size="sm" icon={Search} onClick={ed.findDeadTime}>
          Find
        </Button>
        {suggestions.length > 0 && (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={Scissor}
              onClick={() => {
                onEdit(
                  addCuts(
                    edit,
                    suggestions.map(([a, b]: Range) => ({ start_s: a, end_s: b })),
                  ),
                );
                ed.setSuggestions([]);
              }}
            >
              Cut all ({suggestions.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={Close}
              aria-label="Dismiss suggestions"
              title="Dismiss suggestions"
              onClick={() => ed.setSuggestions([])}
            />
          </>
        )}
      </Group>

      <Group title="Edit list" column>
        <ItemsMenu
          name="Switches"
          empty="Starts on the earliest camera."
          items={edit.switches.map((s, i) => ({
            key: `${s.at_s}-${s.media_id}`,
            text: `${formatTime(s.at_s, 1)} → ${channelName(s.media_id)}`,
            title: s.media_id ? label(s.media_id) : undefined,
            onSeek: () => ed.setT(s.at_s),
            onRemove: () => onEdit(removeSwitch(edit, i)),
          }))}
        />
        <ItemsMenu
          name="Mix"
          empty="No level changes."
          items={edit.mix.map((r, i) => ({
            key: `${r.media_id}-${r.start_s}-${r.end_s}`,
            text: `${formatTime(r.start_s, 1)} – ${formatTime(r.end_s, 1)} ${label(r.media_id)} ${
              r.muted ? "muted" : `${r.gain_db > 0 ? "+" : ""}${r.gain_db} dB`
            }`,
            onSeek: () => ed.setT(r.start_s),
            onRemove: () => onEdit(removeMix(edit, i)),
          }))}
        />
        <ItemsMenu
          name="Cuts"
          empty="Nothing cut."
          items={edit.cuts.map((c, i) => ({
            key: `${c.start_s}-${c.end_s}`,
            text: `${formatTime(c.start_s, 1)} – ${formatTime(c.end_s, 1)} (${(c.end_s - c.start_s).toFixed(1)} s)`,
            onSeek: () => ed.setT(c.start_s),
            onRemove: () => onEdit(removeCut(edit, i)),
          }))}
        />
      </Group>
    </div>
  );
}

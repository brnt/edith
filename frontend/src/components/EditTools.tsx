import { useState } from "preact/hooks";

import {
  addCuts,
  addMix,
  insideCuts,
  levelOver,
  overlapsCut,
  removeCut,
  removeMix,
  removeSwitch,
} from "../lib/editOps";
import { effectiveTracks, formatTime, type Range } from "../lib/timeline";
import type { EditorApi } from "../lib/useEditor";
import { Dropdown, Select } from "./ui";
import {
  RibbonButton,
  RibbonCell,
  RibbonGroup,
  RibbonNumber,
  RibbonSet,
  RibbonSlider,
} from "./RibbonGrid";
import { Icon } from "./Icon";
import { Close, Plus, Scissor, Search, Speaker, SpeakerMuted } from "./icons";

/** The slider's range, in dB; muted shows at the bottom. */
const MIX_MIN_DB = -24;
const MIX_MAX_DB = 12;

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
    <Dropdown block label={`${name} (${items.length})`}>
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
  // The slider follows the drag, then shows what the selection's stretch is set to.
  const [dragDb, setDragDb] = useState<number | null>(null);
  const mixTrack = outputTracks.some((t) => t.media_id === mixChoice)
    ? mixChoice
    : (outputTracks[0]?.media_id ?? "");
  const mixReady = !!selection && !!mixTrack;
  const level = selection && mixTrack ? levelOver(edit, mixTrack, selection) : null;
  const muted = !!level?.muted;
  const shownDb = dragDb ?? (muted ? MIX_MIN_DB : (level?.gain_db ?? 0));
  const setLevel = (gain_db: number, mute: boolean) => {
    if (!selection || !mixTrack) return;
    onEdit(
      addMix(edit, {
        media_id: mixTrack,
        start_s: selection[0],
        end_s: selection[1],
        gain_db,
        muted: mute,
      }),
    );
    setDragDb(null);
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

  const selectionText = selection
    ? `${formatTime(selection[0], 2)}–${formatTime(selection[1], 2)}`
    : "";

  return (
    <div class="flex h-full gap-3">
      <RibbonGroup title={selection ? selectionText : "Selection"}>
        <RibbonSet columns={4}>
          <RibbonButton
            size={2}
            icon={Scissor}
            label="Cut"
            text="Cut"
            hotkey="x"
            disabled={!selection || insideCuts(edit, selection)}
            onClick={ed.cutSelection}
          />
          <RibbonButton
            size={2}
            icon={Plus}
            label="Uncut"
            text="Uncut"
            disabled={!selection || !overlapsCut(edit, selection)}
            onClick={ed.uncutSelection}
          />
        </RibbonSet>
        <RibbonSet columns={4}>
          <RibbonCell columns={4}>
            <Select
              block
              aria-label="Mix track"
              title="Which audio track to adjust over the selection"
              value={mixTrack}
              disabled={!mixReady}
              onChange={(e) => setMixChoice(e.currentTarget.value)}
            >
              {outputTracks.map((t) => (
                <option key={t.media_id} value={t.media_id}>
                  {label(t.media_id)}
                </option>
              ))}
            </Select>
          </RibbonCell>
          <RibbonSlider
            label="Level over the selection (dB)"
            min={MIX_MIN_DB}
            max={MIX_MAX_DB}
            value={shownDb}
            display={dragDb === null && muted ? "muted" : `${shownDb > 0 ? "+" : ""}${shownDb} dB`}
            disabled={!mixReady}
            onInput={setDragDb}
            onCommit={(db) => setLevel(db, false)}
          />
          <RibbonButton
            icon={muted ? SpeakerMuted : Speaker}
            label={muted ? "Unmute" : "Mute"}
            disabled={!mixReady}
            onClick={() => (muted ? setLevel(0, false) : setLevel(0, true))}
          />
        </RibbonSet>
      </RibbonGroup>

      <RibbonGroup
        title={suggestions.length > 0 ? `Dead time · ${suggestions.length} found` : "Dead time"}
      >
        <RibbonSet columns={5}>
          <RibbonNumber
            label="Quieter than (dB)"
            prefix="<"
            unit="dB"
            step={1}
            value={silence.threshold}
            onChange={(v) => ed.setSilence({ ...silence, threshold: v })}
          />
          <RibbonNumber
            label="At least this long (s)"
            prefix="≥"
            unit="s"
            step={0.5}
            value={silence.minS}
            onChange={(v) => ed.setSilence({ ...silence, minS: v })}
          />
          <RibbonButton
            icon={Search}
            label="Find dead time (in the saved range, using the saved tracks)"
            onClick={ed.findDeadTime}
          />
          <RibbonNumber
            label="Keep this much (s)"
            prefix="keep"
            unit="s"
            step={0.1}
            columns={3}
            value={silence.pad}
            onChange={(v) => ed.setSilence({ ...silence, pad: v })}
          />
          <RibbonButton
            icon={Scissor}
            label={`Cut all (${suggestions.length})`}
            disabled={suggestions.length === 0}
            onClick={() => {
              onEdit(
                addCuts(
                  edit,
                  suggestions.map(([a, b]: Range) => ({ start_s: a, end_s: b })),
                ),
              );
              ed.setSuggestions([]);
            }}
          />
          <RibbonButton
            icon={Close}
            label="Dismiss suggestions"
            disabled={suggestions.length === 0}
            onClick={() => ed.setSuggestions([])}
          />
        </RibbonSet>
      </RibbonGroup>

      <RibbonGroup title="Edit list">
        <RibbonSet columns={4}>
          <RibbonCell columns={4}>
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
          </RibbonCell>
          <RibbonCell columns={4}>
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
          </RibbonCell>
          <RibbonCell columns={4}>
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
          </RibbonCell>
        </RibbonSet>
      </RibbonGroup>
    </div>
  );
}

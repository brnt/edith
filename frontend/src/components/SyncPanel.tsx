import { useEffect, useRef, useState } from "preact/hooks";

import {
  inspectRegistration,
  proxyUrl,
  putNudges,
  registrationFileName,
  registrationSoundUrl,
  startSync,
  type EditList,
  type RegistrationInspection,
  type MediaItem,
  type Peaks,
  type SyncResult,
  type SyncState,
  type SyncTemplate,
} from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { formatTime } from "../lib/timeline";
import { MAX_CANVAS_PX, Waveform } from "./Waveform";
import { Badge, Progress, Select } from "./ui";
import { Icon } from "./Icon";
import { RibbonButton, RibbonSet } from "./RibbonGrid";
import {
  Aim,
  CaretRight,
  CheckCircle,
  CloseCircle,
  Download,
  PlaySquare,
  StopSquare,
  Warning,
  ZoomIn,
  ZoomOut,
} from "./icons";

interface Props {
  slug: string;
  media: MediaItem[];
  /** Everything in the project folder, for choosing an audio file that isn't in the project. */
  available: MediaItem[];
  sync: SyncState | null;
  /** The edit, which holds the registration sound's source (`registration`) as a project setting. */
  edit: EditList;
  onEdit: (edit: EditList) => void;
  peaks: Record<string, Peaks>;
  onChange: () => void;
  onError: (message: string) => void;
}

type Mode = SyncTemplate["kind"];

const MAX_TEMPLATE_S = 5;
const WAVE_HEIGHT = 56;
const TONES = { synced: "good", low_confidence: "warn", unsynced: "bad" } as const;
const LABELS = { synced: "synced", low_confidence: "check", unsynced: "not found" } as const;
const MODES: { id: Mode; label: string }[] = [
  { id: "excerpt", label: "Marked in a recording" },
  { id: "seed", label: "Generated from text" },
  { id: "file", label: "An audio file" },
];

const STATUS_ICON = {
  synced: CheckCircle,
  low_confidence: Warning,
  unsynced: CloseCircle,
} as const;

function describe(result: SyncResult | undefined) {
  if (!result) return null;
  return (
    <Badge tone={TONES[result.status]} icon={STATUS_ICON[result.status]}>
      {LABELS[result.status]}
    </Badge>
  );
}

export function SyncPanel(props: Props) {
  const { slug, media, sync, edit, onEdit, peaks, onChange, onError } = props;
  const withAudio = media.filter((m) => m.has_audio && m.kind !== "image");
  // The project's setting; for a project that never set it, the sound its last sync used.
  const saved = edit.registration ?? sync?.template ?? null;
  const [mode, setMode] = useState<Mode>(saved?.kind ?? "excerpt");
  const [sourceId, setSourceId] = useState<string>(saved?.media_id ?? "");
  const [range, setRange] = useState<[number, number] | null>(
    saved?.kind === "excerpt" && saved.start_s != null && saved.end_s != null
      ? [saved.start_s, saved.end_s]
      : null,
  );
  const [seed, setSeed] = useState(saved?.seed ?? "");
  const [filePath, setFilePath] = useState(saved?.path ?? "");
  // Any audio file in the project folder will do as the sound: it is searched for, not added.
  const audioFiles = props.available.filter((m) => m.kind === "audio" && !m.missing);
  const [pxPerSec, setPxPerSec] = useState(20);
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);
  const source = withAudio.find((m) => m.id === sourceId);
  const data = source ? peaks[source.id] : undefined;
  const duration = source?.duration_s ?? 0;
  const px = Math.min(pxPerSec, MAX_CANVAS_PX / Math.max(duration, 1));
  const tooLong = range !== null && range[1] - range[0] > MAX_TEMPLATE_S;

  // Show the saved sound once it loads (the sync state arrives after the first render).
  useEffect(() => {
    if (!saved) return;
    setMode(saved.kind);
    if (saved.kind === "excerpt" && saved.media_id) {
      setSourceId(saved.media_id);
      if (saved.start_s != null && saved.end_s != null) setRange([saved.start_s, saved.end_s]);
    }
    if (saved.kind === "seed") setSeed(saved.seed ?? "");
    if (saved.kind === "file") setFilePath(saved.path ?? "");
  }, [saved?.kind, saved?.media_id, saved?.start_s, saved?.end_s, saved?.seed, saved?.path]);

  useEffect(() => {
    if (!sourceId && withAudio.length) setSourceId(withAudio[0].id);
  }, [withAudio.length]);

  // Reading the marked stretch back: a registration sound is always the generated 32-bit burst, so
  // the server decodes the stretch and says whether it holds one (and which, by its code).
  const [inspection, setInspection] = useState<RegistrationInspection | null>(null);
  useEffect(() => {
    setInspection(null);
    if (mode !== "excerpt" || !source || !range || tooLong || range[1] - range[0] > 10) return;
    let current = true;
    const timer = setTimeout(() => {
      inspectRegistration(slug, source.id, range[0], range[1]).then(
        (found) => current && setInspection(found),
        () => undefined, // not being able to check is not worth a message
      );
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [mode, source?.id, range?.[0], range?.[1]]);

  // Listening, to check the marked stretch is the sound: the whole recording, or just the stretch.
  const audio = useRef<{ el: HTMLAudioElement; timer: number } | null>(null);
  const [playing, setPlaying] = useState<"recording" | "selection" | null>(null);
  const [playT, setPlayT] = useState<number | null>(null);
  // Where "play the whole recording" starts: set by clicking the waveform (to skip a long preamble).
  const [cursor, setCursor] = useState<number | null>(null);
  const stopPlaying = () => {
    if (audio.current) {
      clearInterval(audio.current.timer);
      audio.current.el.pause();
      audio.current = null;
    }
    setPlaying(null);
    setPlayT(null);
  };
  useEffect(() => {
    setCursor(null); // a different recording starts from its beginning
    return stopPlaying; // and so does leaving
  }, [sourceId, mode]);
  // Clicking the waveform puts the playhead there; if something is playing it jumps there too.
  const seek = (t: number) => {
    setCursor(t);
    if (audio.current) {
      audio.current.el.currentTime = t;
      setPlayT(t);
    }
  };
  const play = (what: "recording" | "selection") => {
    const wasPlaying = playing === what;
    stopPlaying();
    if (wasPlaying || !source) return;
    const [from, to] = what === "selection" && range ? range : [cursor ?? 0, Infinity];
    const el = new Audio(proxyUrl(slug, source.id));
    el.currentTime = from;
    // A recording that can't be played (still being prepared, or the browser refuses) says so.
    el.onerror = () => {
      stopPlaying();
      onError("Can't play this recording yet: its preview may still be getting ready.");
    };
    el.play().catch((e: unknown) => {
      if (audio.current?.el !== el) return;
      stopPlaying();
      onError(e instanceof Error ? e.message : String(e));
    });
    const timer = window.setInterval(() => {
      setPlayT(el.currentTime);
      if (el.currentTime >= to || el.ended) stopPlaying();
    }, 50);
    audio.current = { el, timer };
    setPlaying(what);
    setPlayT(from);
  };

  const timeAt = (event: PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, (event.clientX - rect.left) / px);
  };

  const template = (): SyncTemplate | null => {
    if (mode === "seed") return seed.trim() ? { kind: "seed", seed: seed.trim() } : null;
    if (mode === "file") return filePath ? { kind: "file", path: filePath } : null;
    if (!source || !range || tooLong) return null;
    return { kind: "excerpt", media_id: source.id, start_s: range[0], end_s: range[1] };
  };

  // The registration sound is a setting of the project: whatever source is fully chosen (a typed
  // seed, a file, a marked stretch) becomes part of the edit, which marks the project modified (Save
  // keeps it, Undo takes it back) and means Find needs no re-uploading. It is applied a moment after
  // the last change, so typing doesn't add an undo step per letter.
  const chosen = template();
  const same = (a: SyncTemplate | null, b: SyncTemplate | null) =>
    a?.kind === b?.kind &&
    (a?.seed ?? null) === (b?.seed ?? null) &&
    (a?.path ?? null) === (b?.path ?? null) &&
    (a?.media_id ?? null) === (b?.media_id ?? null) &&
    (a?.start_s ?? null) === (b?.start_s ?? null) &&
    (a?.end_s ?? null) === (b?.end_s ?? null);
  const setSource = () => {
    if (chosen && !same(saved, chosen)) onEdit({ ...edit, registration: chosen });
  };
  useEffect(() => {
    if (!chosen || same(saved, chosen)) return;
    const timer = setTimeout(setSource, 500);
    return () => clearTimeout(timer);
  }, [JSON.stringify(chosen), JSON.stringify(saved)]);

  // Enter in the seed field does what the download button does.
  const downloadSound = () => {
    if (!seed.trim()) return;
    setSource(); // and the seed is part of the project from now on
    const link = document.createElement("a");
    link.href = registrationSoundUrl(seed.trim());
    link.download = registrationFileName(seed.trim());
    link.click();
  };

  // A seed needs no marked region: once it is committed (Enter, or leaving the field) every recording
  // is searched for it, with no button to press. Once per seed (not again for the same one).
  const autoFound = useRef<string | null>(null);
  const commitSeed = () => {
    const text = seed.trim();
    if (mode !== "seed" || !text || progress !== null) return;
    const alreadyFound =
      sync?.template?.kind === "seed" &&
      sync.template.seed === text &&
      Object.keys(sync.results).length > 0;
    if (autoFound.current === text || alreadyFound) return;
    autoFound.current = text;
    setSource();
    void run();
  };

  const run = async () => {
    const chosen = template();
    if (!chosen) return;
    setProgress({ value: 0, label: "starting" });
    try {
      const job = await startSync(slug, chosen);
      const done = await waitForJob(job.id, (j) =>
        setProgress({ value: j.progress, label: j.message }),
      );
      if (done.state === "error") onError(done.error ?? "sync failed");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    setProgress(null);
    onChange();
  };

  const nudge = (id: string, ms: number) =>
    putNudges(slug, { ...(sync?.nudges ?? {}), [id]: ms / 1000 }).then(onChange, (e: unknown) =>
      onError(String(e)),
    );

  return (
    <div class="grid h-full grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-4">
      <div class="flex min-h-0 min-w-0 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <label>
            Registration sound{" "}
            <Select
              aria-label="Registration sound source"
              value={mode}
              onChange={(e) => setMode(e.currentTarget.value as Mode)}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>

          {mode === "excerpt" && (
            <>
              <Select
                aria-label="Recording"
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.currentTarget.value);
                  setRange(null);
                }}
              >
                {withAudio.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <RibbonSet columns={4}>
                <RibbonButton
                  icon={ZoomIn}
                  label="Zoom in"
                  onClick={() => setPxPerSec((v) => Math.min(v * 2, 2000))}
                />
                <RibbonButton
                  icon={ZoomOut}
                  label="Zoom out"
                  onClick={() => setPxPerSec((v) => Math.max(v / 2, 2))}
                />
                <RibbonButton
                  icon={playing === "recording" ? StopSquare : CaretRight}
                  label={
                    playing === "recording" ? "Stop the recording" : "Play the whole recording"
                  }
                  disabled={!source}
                  onClick={() => play("recording")}
                />
                <RibbonButton
                  icon={playing === "selection" ? StopSquare : PlaySquare}
                  label={playing === "selection" ? "Stop the selection" : "Play just the selection"}
                  disabled={!source || !range}
                  onClick={() => play("selection")}
                />
              </RibbonSet>
            </>
          )}

          {mode === "seed" && (
            <>
              <input
                class="w-36 rounded bg-neutral-900 px-2 py-1"
                aria-label="Registration text"
                placeholder="e.g. stickshift"
                maxLength={64}
                value={seed}
                onInput={(e) => setSeed(e.currentTarget.value)}
                onBlur={commitSeed}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    downloadSound();
                    commitSeed();
                  }
                }}
              />
              <RibbonSet columns={1}>
                <RibbonButton
                  icon={Download}
                  label="Download the sound to play on set (.wav)"
                  href={seed.trim() ? registrationSoundUrl(seed.trim()) : ""}
                  download={registrationFileName(seed.trim())}
                  disabled={seed.trim() === ""}
                />
              </RibbonSet>
            </>
          )}

          {mode === "file" && (
            <Select
              class="max-w-64"
              aria-label="Audio file"
              value={filePath}
              onChange={(e) => setFilePath(e.currentTarget.value)}
            >
              <option value="">
                {audioFiles.length
                  ? "Choose an audio file…"
                  : "No audio files in the project folder"}
              </option>
              {audioFiles.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.path}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div class="flex flex-wrap items-center gap-2 text-sm">
          <RibbonSet columns={1}>
            <RibbonButton
              icon={Aim}
              label="Find the sound in every file"
              disabled={template() === null || progress !== null}
              onClick={run}
            />
          </RibbonSet>
          {progress && <Progress value={progress.value} label={progress.label} />}
          {mode === "excerpt" && (
            <span class="text-xs text-neutral-400">
              {range
                ? `Selected ${formatTime(range[0], 2)} – ${formatTime(range[1], 2)} (${(range[1] - range[0]).toFixed(2)} s)`
                : "Drag across the beep (a quiet one shows as a small bump) to select it, or click the waveform to start playing from there."}
            </span>
          )}
          {mode === "excerpt" && range && inspection && (
            <span
              class={`inline-flex items-center gap-1 text-xs ${inspection.found ? "text-emerald-300" : "text-amber-300"}`}
              data-testid="decode-result"
              title={
                inspection.found
                  ? "Read back from the sound: the 32 bits a registration sound carries. The same seed always gives the same code."
                  : "Nothing in this stretch reads as a registration sound."
              }
            >
              <Icon icon={inspection.found ? CheckCircle : Warning} />
              {inspection.found
                ? `Registration sound found · code ${inspection.code}`
                : "No registration sound found in this stretch"}
            </span>
          )}
          {tooLong && (
            <span class="text-xs text-amber-300">Select just the sound (at most 5 s).</span>
          )}
        </div>

        {mode === "excerpt" ? (
          <div class="min-h-0 overflow-x-auto overflow-y-hidden rounded border border-neutral-700 bg-neutral-950">
            <div
              class="relative cursor-crosshair"
              style={{ width: Math.max(1, duration * px), height: WAVE_HEIGHT }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                drag.current = { x0: e.clientX, t0: timeAt(e), moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                if (Math.abs(e.clientX - d.x0) > 3) d.moved = true; // a drag, not a click
                if (!d.moved) return;
                const t = timeAt(e);
                setRange([Math.min(d.t0, t), Math.max(d.t0, t)]);
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (d && !d.moved) seek(timeAt(e)); // a click
              }}
            >
              <Waveform peaks={data} pxPerSec={px} width={duration * px} height={WAVE_HEIGHT} />
              {(playT ?? cursor) !== null && (
                <div
                  class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white"
                  style={{ left: (playT ?? cursor ?? 0) * px }}
                  data-testid="sync-playhead"
                />
              )}
              {range && inspection?.found && inspection.offset_s !== null && (
                <div
                  class="pointer-events-none absolute inset-y-1 bg-emerald-400/40 ring-1 ring-emerald-300"
                  style={{ left: (range[0] + inspection.offset_s) * px, width: 0.2 * px }}
                  data-testid="decoded-burst"
                />
              )}
              {range && (
                <div
                  class="absolute inset-y-0 bg-amber-400/30 ring-1 ring-amber-400"
                  style={{ left: range[0] * px, width: Math.max(1, (range[1] - range[0]) * px) }}
                />
              )}
            </div>
          </div>
        ) : (
          <p class="text-xs text-neutral-400">
            {mode === "seed"
              ? "Download the sound and play it after starting and before stopping each device. A different text can still partly match, so check each Match."
              : "An audio file of the sound (silence around it is trimmed), searched for in every recording and not added to the project."}
          </p>
        )}
      </div>

      <div class="min-h-0 min-w-0 overflow-hidden text-sm">
        {sync && Object.keys(sync.results).length > 0 ? (
          <ul class="grid auto-cols-[21.5rem] grid-flow-col grid-rows-5 content-start gap-x-4 gap-y-0.5">
            {media
              .filter((m) => sync.results[m.id])
              .map((m) => {
                const r = sync.results[m.id];
                return (
                  <li key={m.id} class="flex items-center gap-2">
                    <span class="w-24 truncate" title={m.label}>
                      {m.label}
                    </span>
                    {describe(r)}
                    <span
                      class="w-16 text-neutral-400"
                      title="Where this file starts on the timeline"
                    >
                      {r.start_s === null ? "—" : formatTime(r.start_s, 3)}
                    </span>
                    <span
                      class="w-9 text-xs text-neutral-400"
                      title="Match: 1.0 is identical; lower in noisy rooms or for a different sound"
                    >
                      {r.score === null ? "" : r.score.toFixed(2)}
                    </span>
                    <span
                      class="w-16 whitespace-nowrap text-xs text-neutral-500"
                      title="Clock drift relative to the group"
                    >
                      {r.drift_ppm === null ? "" : `${r.drift_ppm.toFixed(0)} ppm`}
                    </span>
                    <input
                      aria-label={`Nudge ${m.label}`}
                      title="Nudge (ms)"
                      class="w-12 rounded bg-neutral-900 px-1 py-0.5"
                      type="number"
                      step="10"
                      value={Math.round((sync.nudges[m.id] ?? 0) * 1000)}
                      onChange={(e) => nudge(m.id, Number(e.currentTarget.value))}
                    />
                  </li>
                );
              })}
          </ul>
        ) : (
          <p class="text-neutral-500">
            Results appear here: each file's start on the timeline, how well the sound matched, its
            clock drift, and whether it was found.
          </p>
        )}
      </div>
    </div>
  );
}

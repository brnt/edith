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
import { Select } from "./ui";
import { Icon } from "./Icon";
import {
  RibbonButton,
  RibbonButtonStack,
  RibbonCell,
  RibbonGroup,
  RibbonNumber,
  RibbonProgress,
  RibbonSet,
  RibbonText,
} from "./RibbonGrid";
import {
  CaretRight,
  CheckCircle,
  CloseCircle,
  Download,
  FileSearch,
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
// The first panel is this many units wide: the source drop-down, its controls and Find fill row one.
const PANEL_COLS = 17;
// The Files panel is this many units wide: a 6-unit name and the 10 units of fixed cells, with gaps.
const FILES_COLS = 12;
/** Files table columns: name (grows) | status | start | match | drift | nudge. */
const FILE_ROW_COLUMNS = "minmax(4rem, 1fr) 32px 66px 52px 40px 56px";
const FILE_HEADERS = [
  { label: "File", pad: "px-1", tip: "File name" },
  { label: "OK", pad: "text-center", tip: "Status: synced, check (a weak match) or not found" },
  { label: "Start", pad: "px-1 text-right", tip: "Where the file starts on the timeline" },
  {
    label: "Match",
    pad: "px-1 text-right",
    tip: "Match: 1.0 is identical; lower in noisy rooms or for a different sound",
  },
  {
    label: "Drift",
    pad: "px-1 text-right",
    tip: "Clock drift relative to the group, in parts per million",
  },
  {
    label: "Nudge",
    pad: "pr-2 text-right",
    tip: "Nudge: move the file by milliseconds after syncing",
  },
];
// The waveform fills its box: two units tall (69 px) less the 2 px inset a side, less the 1 px border.
const WAVE_HEIGHT = 63;
// Only the start of a recording is shown: that is where the registration sound is marked.
const WAVE_LIMIT_S = 120;
// The generated burst is 0.2 s; a marked stretch is trimmed to it, with a little air either side.
const BURST_S = 0.2;
const BURST_PAD_S = 0.005;
const ICON_TEXT = {
  synced: "text-emerald-400",
  low_confidence: "text-amber-400",
  unsynced: "text-red-400",
} as const;
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

/** A drift in ppm, rounded, with an explicit + when positive. */
const signed = (ppm: number) => {
  const n = Math.round(ppm);
  return n > 0 ? `+${n}` : String(n);
};

function describe(result: SyncResult | undefined) {
  if (!result) return null;
  return (
    <span
      class={`flex justify-center text-base ${ICON_TEXT[result.status]}`}
      title={LABELS[result.status]}
    >
      <Icon icon={STATUS_ICON[result.status]} />
      <span class="sr-only">{LABELS[result.status]}</span>
    </span>
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
  // The waveform fits the width of the controls above it; zoom magnifies from there (1 = fit).
  const [zoom, setZoom] = useState(1);
  const [boxW, setBoxW] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null);
  const source = withAudio.find((m) => m.id === sourceId);
  const data = source ? peaks[source.id] : undefined;
  const duration = Math.min(source?.duration_s ?? 0, WAVE_LIMIT_S);
  const fitPx = boxW > 0 ? boxW / Math.max(duration, 1) : 20; // 20 px/s where nothing can be measured
  const px = Math.min(fitPx * zoom, MAX_CANVAS_PX / Math.max(duration, 1));
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
  // Measure the waveform's box, which is as wide as the controls above it.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setBoxW(el.clientWidth));
    watch.observe(el);
    setBoxW(el.clientWidth);
    return () => watch.disconnect();
  }, [mode]);
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

  // A burst that was found is the sound: the marked stretch is trimmed to it, so the search uses
  // exactly the sound however roughly it was marked.
  useEffect(() => {
    if (mode !== "excerpt" || !range || !inspection?.found || inspection.offset_s === null) return;
    const at = range[0] + inspection.offset_s;
    const trimmed: [number, number] = [Math.max(0, at - BURST_PAD_S), at + BURST_S + BURST_PAD_S];
    if (Math.abs(range[0] - trimmed[0]) > 0.01 || Math.abs(range[1] - trimmed[1]) > 0.01) {
      setRange(trimmed);
    }
  }, [inspection]);

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
    setZoom(1);
    return stopPlaying; // and so does leaving
  }, [sourceId, mode]);
  // Zooming stays centred on the playhead, else on the marked stretch, else on what is in view.
  const anchor = useRef<number | null>(null);
  const zoomBy = (factor: number) => {
    const focus = playT ?? cursor ?? (range ? (range[0] + range[1]) / 2 : null);
    const view = box.current;
    anchor.current =
      focus ?? (view ? (view.scrollLeft + view.clientWidth / 2) / Math.max(px, 1e-6) : null);
    setZoom((v) => Math.min(256, Math.max(1, v * factor)));
  };
  useEffect(() => {
    const view = box.current;
    const t = anchor.current;
    anchor.current = null;
    if (view && t !== null) view.scrollLeft = Math.max(0, t * px - view.clientWidth / 2);
  }, [zoom]);
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
    return Math.min(duration, Math.max(0, (event.clientX - rect.left) / px));
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

  const results = sync && Object.keys(sync.results).length > 0 ? sync.results : null;

  return (
    <div class="flex h-full gap-3 overflow-x-auto">
      <RibbonGroup title="Registration sound">
        <RibbonSet columns={PANEL_COLS}>
          {/* The first row is always full: the source, what it needs, and Find in the last cell. */}
          <RibbonCell columns={5}>
            <Select
              block
              aria-label="Registration sound source"
              title="Where the registration sound comes from"
              value={mode}
              onChange={(e) => setMode(e.currentTarget.value as Mode)}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </RibbonCell>

          {mode === "excerpt" && (
            <>
              <RibbonCell columns={9}>
                <Select
                  block
                  aria-label="Recording"
                  title="The recording to mark the sound in"
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
              </RibbonCell>
              <RibbonButton
                icon={playing === "recording" ? StopSquare : CaretRight}
                label={playing === "recording" ? "Stop the recording" : "Play the whole recording"}
                disabled={!source}
                onClick={() => play("recording")}
              />
              <RibbonButton
                icon={playing === "selection" ? StopSquare : PlaySquare}
                label={playing === "selection" ? "Stop the selection" : "Play just the selection"}
                disabled={!source || !range}
                onClick={() => play("selection")}
              />
            </>
          )}

          {mode === "seed" && (
            <>
              <RibbonText
                columns={10}
                label="Registration text"
                placeholder="e.g. stickshift"
                maxLength={64}
                value={seed}
                onInput={setSeed}
                onBlur={commitSeed}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    downloadSound();
                    commitSeed();
                  }
                }}
              />
              <RibbonButton
                icon={Download}
                label="Download the sound to play on set (.wav)"
                href={seed.trim() ? registrationSoundUrl(seed.trim()) : ""}
                download={registrationFileName(seed.trim())}
                disabled={seed.trim() === ""}
              />
            </>
          )}

          {mode === "file" && (
            <RibbonCell columns={11}>
              <Select
                block
                aria-label="Audio file"
                title="An audio file of the sound, from the project folder"
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
            </RibbonCell>
          )}

          <RibbonButton
            icon={FileSearch}
            label="Find the sound in every file"
            disabled={template() === null || progress !== null}
            onClick={run}
          />

          {/* Two rows: the waveform to mark on (with zoom beside it), or what the other sources do. */}
          <div
            class="m-[2px] min-w-0"
            style={{
              gridColumn: `span ${mode === "excerpt" ? PANEL_COLS - 1 : PANEL_COLS}`,
              gridRow: "span 2",
              // The zoom buttons are joined to the waveform: it reaches across the gap to them.
              marginRight: mode === "excerpt" ? -5 : undefined,
            }}
          >
            {mode === "excerpt" ? (
              <div
                ref={box}
                class={`h-full overflow-x-auto overflow-y-hidden border border-[#505050] bg-neutral-950 ${mode === "excerpt" ? "rounded-l-[5px]" : "rounded-[5px]"}`}
              >
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
                      style={{
                        left: range[0] * px,
                        width: Math.max(1, (range[1] - range[0]) * px),
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <p class="text-xs text-neutral-400">
                {mode === "seed"
                  ? "Press Enter to download the sound and search every recording for it. Play it after starting and before stopping each device. A different text can still partly match, so check each Match."
                  : "An audio file of the sound (silence around it is trimmed), searched for in every recording and not added to the project."}
              </p>
            )}
          </div>

          {mode === "excerpt" && (
            <RibbonButtonStack
              column={PANEL_COLS}
              row={2}
              actions={[
                {
                  icon: ZoomIn,
                  label: "Zoom in",
                  onClick: () => zoomBy(2),
                },
                {
                  icon: ZoomOut,
                  label: "Zoom out",
                  disabled: zoom <= 1,
                  onClick: () => zoomBy(0.5),
                },
              ]}
            />
          )}

          {/* The last row: progress, and what is marked and whether it reads as the sound. */}
          {progress && <RibbonProgress value={progress.value} label={progress.label} columns={4} />}
          <div
            class="m-[2px] flex min-w-0 items-center gap-3 text-xs"
            style={{ gridColumn: `span ${progress ? PANEL_COLS - 4 : PANEL_COLS}` }}
          >
            {mode === "excerpt" && (
              <span class="truncate text-neutral-400">
                {range
                  ? `Selected ${formatTime(range[0], 2)} – ${formatTime(range[1], 2)} (${(range[1] - range[0]).toFixed(2)} s)`
                  : "Drag across the beep to select it, or click to play from there."}
              </span>
            )}
            {mode === "excerpt" && range && inspection && (
              <span
                class={`inline-flex min-w-0 items-center gap-1 ${inspection.found ? "text-emerald-300" : "text-amber-300"}`}
                data-testid="decode-result"
                title={
                  inspection.found
                    ? "Read back from the sound: the 32 bits a registration sound carries. The same seed always gives the same code."
                    : "Nothing in this stretch reads as a registration sound."
                }
              >
                <Icon icon={inspection.found ? CheckCircle : Warning} />
                <span class="truncate">
                  {inspection.found
                    ? `Registration sound found · code ${inspection.code}`
                    : "No registration sound found in this stretch"}
                </span>
              </span>
            )}
            {tooLong && (
              <span class="truncate text-amber-300">Select just the sound (at most 5 s).</span>
            )}
          </div>
        </RibbonSet>
      </RibbonGroup>

      <RibbonGroup title="Files">
        {/* A fixed width: the file name takes what the other cells leave (status, start, match, drift
            and nudge take 246px). The headers stay; three files show and the list scrolls. */}
        <div style={{ width: `calc(${FILES_COLS} * 2.0625rem + ${FILES_COLS - 1} * 3px)` }}>
          <div
            class="grid h-[2.0625rem] items-center gap-[3px] overflow-hidden text-xs text-neutral-500 [scrollbar-gutter:stable]"
            style={{ gridTemplateColumns: FILE_ROW_COLUMNS }}
          >
            {FILE_HEADERS.map((h) => (
              <span key={h.label} class={`truncate ${h.pad}`} title={h.tip}>
                {h.label}
              </span>
            ))}
          </div>
          {results ? (
            <div
              class="grid overflow-y-auto [scrollbar-gutter:stable]"
              style={{ gridAutoRows: "2.0625rem", height: "calc(3 * 2.0625rem)" }}
            >
              {media
                .filter((m) => results[m.id])
                .map((m) => {
                  const r = results[m.id];
                  return (
                    <div
                      key={m.id}
                      class="grid items-center gap-[3px] text-sm"
                      style={{ gridTemplateColumns: FILE_ROW_COLUMNS }}
                    >
                      <span class="truncate px-1" title={m.label}>
                        {m.label}
                      </span>
                      <span>{describe(r)}</span>
                      <span
                        class="px-1 text-right font-mono text-xs text-neutral-400"
                        title="Where this file starts on the timeline"
                      >
                        {r.start_s === null ? "—" : formatTime(r.start_s, 3)}
                      </span>
                      <span
                        class="px-1 text-right font-mono text-xs text-neutral-400"
                        title="Match: 1.0 is identical; lower in noisy rooms or for a different sound"
                      >
                        {r.score === null ? "" : r.score.toFixed(2)}
                      </span>
                      <span
                        class="whitespace-nowrap px-1 text-right font-mono text-xs text-neutral-500"
                        title="Clock drift relative to the group, in parts per million"
                      >
                        {r.drift_ppm === null ? "" : signed(r.drift_ppm)}
                      </span>
                      <RibbonNumber
                        label={`Nudge ${m.label}`}
                        unit="ms"
                        step={10}
                        columns={1}
                        value={Math.round((sync?.nudges[m.id] ?? 0) * 1000)}
                        onChange={(v) => nudge(m.id, v)}
                      />
                    </div>
                  );
                })}
            </div>
          ) : (
            <p class="m-[2px] text-xs text-neutral-500">
              Results appear here: each file's start on the timeline, how well the sound matched,
              its clock drift, and whether it was found.
            </p>
          )}
        </div>
      </RibbonGroup>
    </div>
  );
}

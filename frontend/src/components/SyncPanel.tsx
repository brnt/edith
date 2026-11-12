import { useEffect, useRef, useState } from "preact/hooks";

import {
  putNudges,
  registrationSoundUrl,
  startSync,
  type MediaItem,
  type Peaks,
  type SyncResult,
  type SyncState,
  type SyncTemplate,
} from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { formatTime } from "../lib/timeline";
import { MAX_CANVAS_PX, Waveform } from "./Waveform";
import { Badge, Button, neutralLink, Progress, Select } from "./ui";
import { Icon } from "./Icon";
import { CheckCircle, CloseCircle, Download, Search, Warning, ZoomIn, ZoomOut } from "./icons";

interface Props {
  slug: string;
  media: MediaItem[];
  /** Everything in the project folder, for choosing an audio file that isn't in the project. */
  available: MediaItem[];
  sync: SyncState | null;
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
  const { slug, media, sync, peaks, onChange, onError } = props;
  const withAudio = media.filter((m) => m.has_audio && m.kind !== "image");
  const saved = sync?.template ?? null;
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
  const drag = useRef<{ x0: number; t0: number } | null>(null);
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
              <Button icon={ZoomIn} onClick={() => setPxPerSec((v) => Math.min(v * 2, 2000))}>
                Zoom in
              </Button>
              <Button icon={ZoomOut} onClick={() => setPxPerSec((v) => Math.max(v / 2, 2))}>
                Zoom out
              </Button>
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
              />
              <a
                class={`inline-flex items-center gap-1.5 rounded px-3 py-1 ${neutralLink(
                  seed.trim() !== "",
                )}`}
                href={seed.trim() ? registrationSoundUrl(seed.trim()) : undefined}
                download="registration.wav"
                title="Download the sound to play on set"
              >
                <Icon icon={Download} />
                Download .wav
              </a>
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
          <Button icon={Search} disabled={template() === null || progress !== null} onClick={run}>
            Find the sound in every file
          </Button>
          {progress && <Progress value={progress.value} label={progress.label} />}
          {mode === "excerpt" && (
            <span class="text-xs text-neutral-400">
              {range
                ? `Selected ${formatTime(range[0], 2)} – ${formatTime(range[1], 2)} (${(range[1] - range[0]).toFixed(2)} s)`
                : "Drag across the beep (a quiet one shows as a small bump) to select it."}
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
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { x0: e.clientX, t0: timeAt(e) };
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                const t = timeAt(e);
                setRange([Math.min(drag.current.t0, t), Math.max(drag.current.t0, t)]);
              }}
              onPointerUp={() => (drag.current = null)}
            >
              <Waveform peaks={data} pxPerSec={px} width={duration * px} height={WAVE_HEIGHT} />
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

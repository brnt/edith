import { useEffect, useRef, useState } from "preact/hooks";

import {
  putNudges,
  startSync,
  type MediaItem,
  type Peaks,
  type SyncResult,
  type SyncState,
} from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { formatTime } from "../lib/timeline";
import { MAX_CANVAS_PX, Waveform } from "./Waveform";
import { Badge, Button, Progress } from "./ui";

interface Props {
  slug: string;
  media: MediaItem[];
  sync: SyncState | null;
  peaks: Record<string, Peaks>;
  onChange: () => void;
  onError: (message: string) => void;
}

const MAX_TEMPLATE_S = 5;
const WAVE_HEIGHT = 64;
const TONES = { synced: "good", low_confidence: "warn", unsynced: "bad" } as const;
const LABELS = { synced: "synced", low_confidence: "check", unsynced: "not found" } as const;

function describe(result: SyncResult | undefined) {
  if (!result) return null;
  return <Badge tone={TONES[result.status]}>{LABELS[result.status]}</Badge>;
}

export function SyncPanel({ slug, media, sync, peaks, onChange, onError }: Props) {
  const withAudio = media.filter((m) => m.has_audio && m.kind !== "image");
  const [sourceId, setSourceId] = useState<string>(sync?.template?.media_id ?? "");
  const [range, setRange] = useState<[number, number] | null>(
    sync?.template ? [sync.template.start_s, sync.template.end_s] : null,
  );
  const [pxPerSec, setPxPerSec] = useState(20);
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null);
  const drag = useRef<{ x0: number; t0: number } | null>(null);
  const source = withAudio.find((m) => m.id === sourceId);
  const data = source ? peaks[source.id] : undefined;
  const duration = source?.duration_s ?? 0;
  const px = Math.min(pxPerSec, MAX_CANVAS_PX / Math.max(duration, 1));

  // Show the saved template once it loads; otherwise default to the first recording.
  useEffect(() => {
    if (sync?.template) {
      setSourceId(sync.template.media_id);
      setRange([sync.template.start_s, sync.template.end_s]);
    }
  }, [sync?.template?.media_id, sync?.template?.start_s, sync?.template?.end_s]);

  useEffect(() => {
    if (!sourceId && withAudio.length) setSourceId(withAudio[0].id);
  }, [withAudio.length]);

  const tooLong = range !== null && range[1] - range[0] > MAX_TEMPLATE_S;

  const timeAt = (event: PointerEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, (event.clientX - rect.left) / px);
  };

  const run = async () => {
    if (!source || !range) return;
    setProgress({ value: 0, label: "starting" });
    try {
      const job = await startSync(slug, {
        media_id: source.id,
        start_s: range[0],
        end_s: range[1],
      });
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
    <div class="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
      <div class="flex min-h-0 min-w-0 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <label>
            Registration sound in{" "}
            <select
              class="rounded bg-neutral-900 px-2 py-1"
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
            </select>
          </label>
          <Button onClick={() => setPxPerSec((v) => Math.min(v * 2, 2000))}>Zoom in</Button>
          <Button onClick={() => setPxPerSec((v) => Math.max(v / 2, 2))}>Zoom out</Button>
          <Button variant="primary" disabled={!range || tooLong || progress !== null} onClick={run}>
            Find the sound in every file
          </Button>
          {progress && <Progress value={progress.value} label={progress.label} />}
          <span class="text-xs text-neutral-400">
            {range
              ? `Selected ${formatTime(range[0], 2)} – ${formatTime(range[1], 2)} (${(range[1] - range[0]).toFixed(2)} s)`
              : "Drag across the beep (a quiet one shows as a small bump) to select it."}
          </span>
          {tooLong && (
            <span class="text-xs text-amber-300">Select just the sound (at most 5 s).</span>
          )}
        </div>
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
      </div>

      <div class="min-h-0 min-w-0 overflow-hidden text-sm">
        {sync && Object.keys(sync.results).length > 0 ? (
          <ul class="grid auto-cols-[21rem] grid-flow-col grid-rows-5 content-start gap-x-4 gap-y-0.5">
            {media
              .filter((m) => sync.results[m.id])
              .map((m) => {
                const r = sync.results[m.id];
                return (
                  <li key={m.id} class="flex items-center gap-2">
                    <span class="w-28 truncate" title={m.label}>
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
                      class="w-16 whitespace-nowrap text-xs text-neutral-500"
                      title="Clock drift relative to the group"
                    >
                      {r.drift_ppm === null ? "" : `${r.drift_ppm.toFixed(0)} ppm`}
                    </span>
                    <input
                      aria-label={`Nudge ${m.label}`}
                      title="Nudge (ms)"
                      class="w-14 rounded bg-neutral-900 px-1 py-0.5"
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
            Results appear here: each file's start on the timeline, its clock drift, and whether the
            sound was found.
          </p>
        )}
      </div>
    </div>
  );
}

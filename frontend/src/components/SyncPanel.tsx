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
    <div class="space-y-4">
      <p class="text-sm text-neutral-400">
        Select the registration sound (the beep played after recording started) in any recording
        that has it. The same sound is then searched for at the start and end of every file.
      </p>
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label>
          Recording{" "}
          <select
            class="rounded bg-neutral-800 px-2 py-1"
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
        <span class="text-neutral-400">
          {range
            ? `Selected ${formatTime(range[0], 2)} – ${formatTime(range[1], 2)} (${(range[1] - range[0]).toFixed(2)} s)`
            : "Drag across the sound to select it"}
        </span>
        {tooLong && <span class="text-amber-300">Select just the sound (at most 5 s).</span>}
      </div>
      <div class="overflow-x-auto rounded border border-neutral-800 bg-neutral-950">
        <div
          class="relative cursor-crosshair"
          style={{ width: Math.max(1, duration * px), height: 96 }}
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
          <Waveform peaks={data} pxPerSec={px} width={duration * px} height={96} />
          {range && (
            <div
              class="absolute inset-y-0 bg-amber-400/30 ring-1 ring-amber-400"
              style={{ left: range[0] * px, width: Math.max(1, (range[1] - range[0]) * px) }}
            />
          )}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <Button variant="primary" disabled={!range || tooLong || progress !== null} onClick={run}>
          Find the sound in every file
        </Button>
        {progress && <Progress value={progress.value} label={progress.label} />}
      </div>

      {sync && Object.keys(sync.results).length > 0 && (
        <table class="w-full text-sm">
          <thead class="text-left text-neutral-500">
            <tr>
              <th>File</th>
              <th>Result</th>
              <th>Starts at</th>
              <th>Drift</th>
              <th>Match</th>
              <th>Nudge (ms)</th>
            </tr>
          </thead>
          <tbody>
            {media
              .filter((m) => sync.results[m.id])
              .map((m) => {
                const r = sync.results[m.id];
                return (
                  <tr key={m.id} class="border-t border-neutral-800">
                    <td class="py-1">{m.label}</td>
                    <td>{describe(r)}</td>
                    <td>{r.start_s === null ? "—" : formatTime(r.start_s, 3)}</td>
                    <td>{r.drift_ppm === null ? "—" : `${r.drift_ppm.toFixed(0)} ppm`}</td>
                    <td>{r.score === null ? "—" : r.score.toFixed(2)}</td>
                    <td>
                      <input
                        aria-label={`Nudge ${m.label}`}
                        class="w-20 rounded bg-neutral-800 px-2 py-0.5"
                        type="number"
                        step="10"
                        value={Math.round((sync.nudges[m.id] ?? 0) * 1000)}
                        onChange={(e) => nudge(m.id, Number(e.currentTarget.value))}
                      />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </div>
  );
}

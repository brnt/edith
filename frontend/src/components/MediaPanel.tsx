import { useState } from "preact/hooks";

import { addMedia, removeMedia, startProxies, type Job, type MediaItem } from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { formatTime } from "../lib/timeline";
import { LibraryBrowser } from "./LibraryBrowser";
import { Badge, Button, Progress } from "./ui";

interface Props {
  slug: string;
  media: MediaItem[];
  onChange: () => void;
  onError: (message: string) => void;
}

export function MediaPanel({ slug, media, onChange, onError }: Props) {
  const [browsing, setBrowsing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const missing = media.filter((m) => !m.proxy_ready).length;

  const add = async (paths: string[]) => {
    setBrowsing(false);
    try {
      for (const path of paths) await addMedia(slug, path);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    onChange();
  };

  const buildProxies = async () => {
    try {
      const started = await startProxies(slug);
      setJob(started);
      const done = await waitForJob(started.id, setJob);
      if (done.state === "error") onError(done.error ?? "proxy build failed");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    setJob(null);
    onChange();
  };

  return (
    <div class="flex h-full gap-4">
      <div class="flex shrink-0 flex-col items-start gap-2">
        <Button variant="primary" onClick={() => setBrowsing(true)}>
          Add media…
        </Button>
        <Button disabled={missing === 0 || job !== null} onClick={buildProxies}>
          Build proxies{missing ? ` (${missing})` : ""}
        </Button>
        {job && <Progress value={job.progress} label={job.message} />}
      </div>
      {media.length === 0 ? (
        <p class="self-center text-sm text-neutral-500">
          No media yet. Add the camera and audio files from this session; they stay where they are.
        </p>
      ) : (
        <ul class="grid min-w-0 auto-cols-[17rem] grid-flow-col grid-rows-4 content-start gap-x-4 gap-y-1 text-sm">
          {media.map((m) => (
            <li key={m.id} class="flex items-center gap-2" title={details(m)}>
              <Badge>{m.kind}</Badge>
              <span class="min-w-0 flex-1 truncate">{m.label}</span>
              {m.proxy_ready ? (
                <Badge tone="good">proxy</Badge>
              ) : (
                <Badge tone="warn">no proxy</Badge>
              )}
              <button
                class="text-neutral-500 hover:text-red-400"
                aria-label={`Remove ${m.label}`}
                onClick={() =>
                  removeMedia(slug, m.id).then(onChange, (e: unknown) => onError(String(e)))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {browsing && <LibraryBrowser onAdd={add} onClose={() => setBrowsing(false)} />}
    </div>
  );
}

function details(m: MediaItem): string {
  return [
    m.label,
    m.duration_s ? formatTime(m.duration_s) : "",
    m.width ? `${m.width}×${m.height}` : "",
    m.fps ? `${m.fps.toFixed(2)} fps` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

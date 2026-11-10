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
    <div>
      <div class="mb-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => setBrowsing(true)}>
          Add media…
        </Button>
        <Button disabled={missing === 0 || job !== null} onClick={buildProxies}>
          Build preview proxies{missing ? ` (${missing})` : ""}
        </Button>
        {job && <Progress value={job.progress} label={job.message} />}
      </div>
      {media.length === 0 ? (
        <p class="text-sm text-neutral-500">
          No media yet. Add the camera and audio files from this session; they stay where they are.
        </p>
      ) : (
        <table class="w-full text-sm">
          <tbody>
            {media.map((m) => (
              <tr key={m.id} class="border-t border-neutral-800">
                <td class="py-1 pr-3">{m.label}</td>
                <td class="pr-3">
                  <Badge>{m.kind}</Badge>
                </td>
                <td class="pr-3 text-neutral-400">
                  {m.duration_s ? formatTime(m.duration_s) : "—"}
                  {m.width ? ` · ${m.width}×${m.height}` : ""}
                  {m.fps ? ` · ${m.fps.toFixed(2)} fps` : ""}
                </td>
                <td class="pr-3">
                  {m.proxy_ready ? (
                    <Badge tone="good">proxy</Badge>
                  ) : (
                    <Badge tone="warn">no proxy</Badge>
                  )}
                </td>
                <td class="text-right">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      removeMedia(slug, m.id).then(onChange, (e: unknown) => onError(String(e)))
                    }
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {browsing && <LibraryBrowser onAdd={add} onClose={() => setBrowsing(false)} />}
    </div>
  );
}

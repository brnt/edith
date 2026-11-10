import { useEffect, useState } from "preact/hooks";

import { fetchRenders, renderUrl, startRender, type Job, type RenderFile } from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { Button, Progress } from "./ui";

export function RenderPanel({
  slug,
  disabled,
  onError,
}: {
  slug: string;
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const [files, setFiles] = useState<RenderFile[]>([]);
  const [job, setJob] = useState<Job | null>(null);

  const refresh = () => fetchRenders(slug).then(setFiles, (e: unknown) => onError(String(e)));
  useEffect(() => {
    void refresh();
  }, [slug]);

  const render = async () => {
    try {
      const started = await startRender(slug);
      setJob(started);
      const done = await waitForJob(started.id, setJob, 1000);
      if (done.state === "error") onError(done.error ?? "render failed");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
    setJob(null);
    await refresh();
  };

  return (
    <div class="space-y-2 text-sm">
      <div class="flex items-center gap-3">
        <Button variant="primary" disabled={disabled || job !== null} onClick={render}>
          Render MP4 (1080p)
        </Button>
        {job && <Progress value={job.progress} label={job.message} />}
        <span class="text-neutral-500">
          Renders the saved edit from the full-resolution originals into the project folder.
        </span>
      </div>
      {files.length > 0 && (
        <ul class="space-y-1">
          {files.map((f) => (
            <li key={f.name}>
              <a class="text-sky-300 underline" href={renderUrl(slug, f.name)} download>
                {f.name}
              </a>{" "}
              <span class="text-neutral-500">{(f.size / 1e6).toFixed(1)} MB</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

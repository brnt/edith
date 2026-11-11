import { useEffect, useState } from "preact/hooks";

import { fetchRenders, renderUrl, startRender, type Job, type RenderFile } from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { Button, Dropdown, Progress } from "./ui";
import { PlayCircle } from "./icons";

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
    <>
      <Button icon={PlayCircle} disabled={disabled || job !== null} onClick={render}>
        Render MP4 (1080p)
      </Button>
      {job && <Progress value={job.progress} label={job.message} />}
      <Dropdown label={`Renders (${files.length})`}>
        {files.length === 0 ? (
          <p class="text-neutral-500">No renders yet.</p>
        ) : (
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
      </Dropdown>
    </>
  );
}

import { useEffect, useState } from "preact/hooks";

import { fetchRenders, renderUrl, startRender, type Job, type RenderFile } from "../lib/api";
import { waitForJob } from "../lib/jobs";
import { Dropdown, Progress } from "./ui";
import { RibbonButton, RibbonCell, RibbonGroup, RibbonSet } from "./RibbonGrid";
import { PlayCircle } from "./icons";

export function RenderPanel({
  slug,
  disabled,
  title,
  height,
  container,
  onError,
}: {
  slug: string;
  disabled: boolean;
  /** The panel's caption (the output length, or a reminder to save first). */
  title: string;
  /** The output's height in pixels, for the button's name ("Render MP4 (1080p)"). */
  height: number;
  /** The file type being made ("MP4" or "MOV"), for the button's name. */
  container: string;
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
    <RibbonGroup title={title}>
      <RibbonSet columns={4}>
        <RibbonButton
          size={2}
          icon={PlayCircle}
          label={`Render ${container} (${height}p)`}
          text="Render"
          disabled={disabled || job !== null}
          onClick={render}
        />
        {job && (
          <RibbonCell columns={2}>
            <Progress value={job.progress} label={job.message} />
          </RibbonCell>
        )}
      </RibbonSet>
      <RibbonSet columns={4}>
        <RibbonCell columns={4}>
          <Dropdown block label={`Renders (${files.length})`}>
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
        </RibbonCell>
      </RibbonSet>
    </RibbonGroup>
  );
}

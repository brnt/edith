import { fetchJob, type Job } from "./api";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a background job until it finishes, reporting progress along the way. */
export async function waitForJob(
  id: string,
  onUpdate?: (job: Job) => void,
  intervalMs = 400,
): Promise<Job> {
  for (;;) {
    const job = await fetchJob(id);
    onUpdate?.(job);
    if (job.state !== "running") return job;
    await sleep(intervalMs);
  }
}

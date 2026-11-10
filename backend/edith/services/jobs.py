"""Background jobs (proxy builds, sync) for a single local process.

Deliberately tiny: an in-memory table and a small thread pool. State is lost on restart,
which is fine because everything a job produces is on disk (cache files, project documents).
"""

import threading
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal

import structlog

log = structlog.get_logger()


@dataclass
class Job:
    id: str
    label: str
    state: Literal["running", "done", "error"] = "running"
    progress: float = 0.0  # 0..1
    message: str = ""
    error: str | None = None
    result: dict[str, Any] | None = None
    _future: Future | None = field(default=None, repr=False)


class JobRunner:
    def __init__(self, workers: int = 2) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, label: str, fn: Callable[[Job], dict[str, Any] | None]) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], label=label)

        def run() -> None:
            try:
                job.result = fn(job)
                job.progress, job.state = 1.0, "done"
            except Exception as exc:  # report to the caller; never crash the pool thread
                log.exception("job_failed", job=job.id, label=label)
                job.error, job.state = f"{type(exc).__name__}: {exc}", "error"

        with self._lock:
            self._jobs[job.id] = job
        job._future = self._pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def wait(self, job_id: str, timeout: float = 60.0) -> Job:
        job = self._jobs[job_id]
        assert job._future is not None
        job._future.result(timeout=timeout)
        return job


jobs = JobRunner()

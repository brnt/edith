import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

log = structlog.get_logger()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Bind a request id to every log line for the request, and emit one
    structured access line (with status + duration) per request."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        log.info("request", http_status=response.status_code, duration_ms=duration_ms)
        response.headers["X-Request-ID"] = request_id
        return response

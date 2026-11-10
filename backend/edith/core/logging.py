import logging
import sys

import structlog

from edith.core.config import get_settings


def configure_logging() -> None:
    """Route BOTH structlog and stdlib logging (incl. uvicorn) to canonical JSON.

    One JSON object per line on stdout in every environment (see
    conventions/logging.md). Set LOG_FORMAT=console for a human renderer during
    local debugging only.
    """
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts")
    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        timestamper,
    ]

    # structlog's own events -> stdlib logging, carrying callsite info.
    structlog.configure(
        processors=[
            *shared,
            structlog.processors.CallsiteParameterAdder(
                {
                    structlog.processors.CallsiteParameter.MODULE,
                    structlog.processors.CallsiteParameter.FUNC_NAME,
                    structlog.processors.CallsiteParameter.LINENO,
                }
            ),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    renderer = (
        structlog.dev.ConsoleRenderer()
        if settings.log_format == "console"
        else structlog.processors.JSONRenderer()
    )
    # A single stdlib formatter renders every record — structlog and foreign
    # (uvicorn, SQLAlchemy, ...) — through the same processors.
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.dict_tracebacks,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Route uvicorn's own loggers through the root handler (as JSON).
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True

    # We emit a richer, correlated access line in RequestIDMiddleware, so silence
    # uvicorn's own access logger here. Do it at the logger (not via uvicorn's
    # --no-access-log flag): this function re-runs at import and would otherwise
    # re-enable propagation, so the logger-level silencing is what actually holds.
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = []
    access_logger.propagate = False

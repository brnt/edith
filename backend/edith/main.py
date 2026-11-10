from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from edith.api.edit import router as edit_router
from edith.api.errors import register_error_handlers
from edith.api.export import router as export_router
from edith.api.media import router as media_router
from edith.api.routes import router
from edith.api.sync import router as sync_router
from edith.core.config import get_settings
from edith.core.logging import configure_logging
from edith.core.middleware import RequestIDMiddleware

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("startup", app=settings.app_name, environment=settings.environment)
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    configure_logging()  # configure at import so uvicorn's own logs are JSON too
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(RequestIDMiddleware)
    app.include_router(router)
    app.include_router(media_router)
    app.include_router(sync_router)
    app.include_router(edit_router)
    app.include_router(export_router)
    register_error_handlers(app)
    return app


app = create_app()

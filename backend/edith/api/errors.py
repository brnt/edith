from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from edith.core import errors

# Literal: starlette renamed its 422 constant between releases.
_UNPROCESSABLE = 422

# The single place domain errors become HTTP statuses.
_STATUS: dict[type[errors.EdithError], int] = {
    errors.ProjectNotFound: status.HTTP_404_NOT_FOUND,
    errors.ProjectExists: status.HTTP_409_CONFLICT,
    errors.InvalidProjectName: _UNPROCESSABLE,
    errors.NotAProjectFile: _UNPROCESSABLE,
    errors.UnsupportedVersion: _UNPROCESSABLE,
    errors.ReadOnlyProject: status.HTTP_409_CONFLICT,
    errors.MediaNotFound: status.HTTP_404_NOT_FOUND,
    errors.InvalidMediaPath: _UNPROCESSABLE,
    errors.MediaError: _UNPROCESSABLE,
    errors.InvalidTemplate: _UNPROCESSABLE,
}


def register_error_handlers(app: FastAPI) -> None:
    async def handle(_request: Request, exc: Exception) -> JSONResponse:
        code = _STATUS.get(type(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)
        return JSONResponse({"detail": type(exc).__name__, "message": str(exc)}, status_code=code)

    app.add_exception_handler(errors.EdithError, handle)

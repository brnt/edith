from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from edith.core.config import get_settings

_bearer = HTTPBearer(auto_error=False)


async def require_token(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    expected = get_settings().api_token
    if creds is None or creds.credentials != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )

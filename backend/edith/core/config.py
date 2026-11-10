from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "edith"
    environment: str = "development"
    log_level: str = "INFO"
    log_format: str = "json"  # "json" (default) | "console" (local eyeballing)
    api_token: str = "dev-token"
    # Root folder holding one sub-folder per project (project file + its media).
    library_dir: Path = Path("../.library")
    # Where the library lives on the user's machine, for file paths written into exports
    # (inside Docker the library is mounted at a different path). Empty = library_dir.
    host_library_dir: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()

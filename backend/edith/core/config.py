from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    app_name: str = "edith"
    environment: str = "development"
    log_level: str = "INFO"
    log_format: str = "json"  # "json" (default) | "console" (local eyeballing)
    api_token: str = "dev-token"
    # Edith's own small bits of state (the recent-projects list). Projects are self-contained
    # folders anywhere on disk and keep everything else in the folder, so this holds nothing else.
    state_dir: Path = Field(default_factory=lambda: Path.home() / ".edith")
    # A folder of projects from before projects were self-contained (one sub-folder per project).
    # Its projects are converted and added to the recent list at startup, once. Unset = nothing to
    # import. (The old name for this setting was LIBRARY_DIR.)
    legacy_library_dir: Path | None = Field(
        default=None, validation_alias=AliasChoices("LEGACY_LIBRARY_DIR", "LIBRARY_DIR")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()

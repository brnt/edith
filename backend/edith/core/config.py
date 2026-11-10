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


@lru_cache
def get_settings() -> Settings:
    return Settings()

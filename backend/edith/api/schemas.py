from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    created_at: datetime
    needs_upgrade: bool

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class IdentificationRequest(BaseModel):
    description: str = Field(min_length=3, max_length=2000)

    @field_validator("description", mode="before")
    @classmethod
    def trim_description(cls, value):
        return value.strip() if isinstance(value, str) else value


class Suggestion(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: Literal["organic", "inorganic"]
    reason: str = Field(min_length=1, max_length=600)


class Identification(BaseModel):
    clarification: str | None = Field(default=None, max_length=600)
    candidates: list[Suggestion] = Field(default_factory=list, max_length=10)


class Message(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(min_length=1, max_length=6000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=24)


class ProjectionRequest(BaseModel):
    kind: Literal["skeletal", "wedge", "newman", "sawhorse", "fischer"]
    bond: int | None = Field(default=None, ge=0)
    reverse: bool = False


class ResolveRequest(BaseModel):
    description: str = Field(min_length=3, max_length=2000)
    identification: Identification

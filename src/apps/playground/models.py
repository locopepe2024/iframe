from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field, model_validator


class PlaygroundMode(str, Enum):
    T2I = "t2i"
    I2I = "i2i"
    T2V = "t2v"
    I2V = "i2v"
    R2V = "r2v"
    F2V = "f2v"
    V2V = "v2v"


class PlaygroundOutput(BaseModel):
    id: str = Field(..., description="Unique identifier (UUID)")
    media_path: str = Field(..., description="Generated file path relative to output/")
    media_type: str = Field(..., description="Output media type: image or video")
    thumbnail_path: Optional[str] = Field(None, description="Thumbnail file path relative to output/")
    saved_to_library: bool = Field(False, description="Whether this output has been saved to the project library")


class PlaygroundDraft(BaseModel):
    media_names: dict[str, str] = Field(default_factory=dict, description="Display names only; never media identity")
    mode: PlaygroundMode = Field(PlaygroundMode.T2I, description="Current generation mode")
    model_id: str = Field("", description="Currently selected model")
    prompt: str = Field("", description="Editable prompt draft")
    negative_prompt: Optional[str] = Field(None, description="Editable negative prompt")
    input_media: List[str] = Field(default_factory=list, description="Current reference media")
    parameters: dict = Field(default_factory=dict, description="Current generation parameters")
    batch_size: int = Field(1, ge=1, le=4, description="Current output count")
    parent_generation_id: Optional[str] = Field(None, description="Generation restored for continued editing")


class PlaygroundSession(BaseModel):
    id: str = Field(..., description="Unique session identifier")
    title: str = Field(..., description="User-visible session title")
    draft: PlaygroundDraft = Field(default_factory=PlaygroundDraft)
    created_at: str = Field(..., description="Creation timestamp in ISO 8601 format")
    updated_at: str = Field(..., description="Last activity timestamp in ISO 8601 format")
    owner_user_id: Optional[str] = Field(None, description="Authenticated owning user")
    owner_profile_id: Optional[str] = Field(None, description="Authenticated owning profile")


class PlaygroundGeneration(BaseModel):
    media_names: dict[str, str] = Field(default_factory=dict, description="Display names only; never media identity")
    id: str = Field(..., description="Unique identifier (UUID)")
    mode: PlaygroundMode = Field(..., description="Generation mode")
    model_id: str = Field(..., description="Model identifier from model catalog")
    prompt: str = Field(..., description="Text prompt for generation")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt to exclude undesired elements")
    input_media: List[str] = Field(default_factory=list, description="Input file paths for image/video-conditioned modes")
    parameters: dict = Field(default_factory=dict, description="Generation parameters (resolution, duration, aspect_ratio, etc.)")
    batch_size: int = Field(1, ge=1, le=4, description="Number of outputs to generate per request (1-4)")
    outputs: List[PlaygroundOutput] = Field(default_factory=list, description="Generated outputs")
    status: str = Field("pending", description="Generation status: pending/processing/completed/failed")
    error: Optional[str] = Field(None, description="Error message if generation failed")
    created_at: str = Field(..., description="Creation timestamp in ISO 8601 format")
    session_id: Optional[str] = Field(None, description="Owning creation session")
    parent_generation_id: Optional[str] = Field(None, description="Generation used as the editable source for this run")
    owner_user_id: Optional[str] = Field(None, description="Authenticated owning user")
    owner_profile_id: Optional[str] = Field(None, description="Authenticated owning profile")


class PlaygroundTemplate(BaseModel):
    id: str = Field(..., description="Unique identifier (UUID)")
    name: str = Field(..., description="Template display name")
    category: str = Field("general", description="Template category: image/video/general")
    prompt: str = Field(..., description="Template prompt text")
    negative_prompt: Optional[str] = Field(None, description="Default negative prompt")
    default_mode: Optional[PlaygroundMode] = Field(None, description="Default generation mode for this template")
    default_model_id: Optional[str] = Field(None, description="Default model identifier")
    default_parameters: dict = Field(default_factory=dict, description="Default generation parameters")
    created_at: str = Field(..., description="Creation timestamp in ISO 8601 format")
    updated_at: str = Field(..., description="Last update timestamp in ISO 8601 format")
    owner_user_id: Optional[str] = Field(None, description="Authenticated owning user")
    owner_profile_id: Optional[str] = Field(None, description="Authenticated owning profile")


class GenerateRequest(BaseModel):
    media_names: dict[str, str] = Field(default_factory=dict, description="Display names only; never media identity")
    mode: PlaygroundMode = Field(..., description="Generation mode")
    model_id: str = Field(..., description="Model identifier from model catalog")
    prompt: str = Field(..., description="Text prompt for generation")
    negative_prompt: Optional[str] = Field(None, description="Negative prompt to exclude undesired elements")
    input_media: Optional[List[str]] = Field(None, description="Input file paths for image/video-conditioned modes")
    parameters: Optional[dict] = Field(None, description="Generation parameters (resolution, duration, aspect_ratio, etc.)")
    batch_size: Optional[int] = Field(1, ge=1, le=4, description="Number of outputs to generate (1-4)")
    session_id: Optional[str] = Field(None, description="Creation session for this generation")
    parent_generation_id: Optional[str] = Field(None, description="Generation being edited and continued")

    @model_validator(mode="after")
    def validate_mode_media(self):
        if self.mode == PlaygroundMode.F2V and len(self.input_media or []) != 2:
            raise ValueError("f2v requires exactly two images: first frame and last frame")
        return self


class CreateSessionRequest(BaseModel):
    title: Optional[str] = Field(None, description="Optional session title")


class UpdateSessionRequest(BaseModel):
    title: Optional[str] = Field(None, description="Updated session title")
    draft: Optional[PlaygroundDraft] = Field(None, description="Current editable session draft")


class SaveToLibraryRequest(BaseModel):
    category: str = Field("general", description="Library category for the saved output")


class CreateTemplateRequest(BaseModel):
    name: str = Field(..., description="Template display name")
    category: Optional[str] = Field("general", description="Template category: image/video/general")
    prompt: str = Field(..., description="Template prompt text")
    negative_prompt: Optional[str] = Field(None, description="Default negative prompt")
    default_mode: Optional[PlaygroundMode] = Field(None, description="Default generation mode")
    default_model_id: Optional[str] = Field(None, description="Default model identifier")
    default_parameters: Optional[dict] = Field(None, description="Default generation parameters")


class UpdateTemplateRequest(BaseModel):
    name: Optional[str] = Field(None, description="Template display name")
    category: Optional[str] = Field(None, description="Template category: image/video/general")
    prompt: Optional[str] = Field(None, description="Template prompt text")
    negative_prompt: Optional[str] = Field(None, description="Default negative prompt")
    default_mode: Optional[PlaygroundMode] = Field(None, description="Default generation mode")
    default_model_id: Optional[str] = Field(None, description="Default model identifier")
    default_parameters: Optional[dict] = Field(None, description="Default generation parameters")

from pydantic import BaseModel
from typing import Optional, List, Any

class Message(BaseModel):
    role: str
    text: str

# Media object for photos, videos, reels, posts
class MediaObject(BaseModel):
    type: str  # "photo", "video", "reel", "post"
    url: str
    alt: Optional[str] = None
    ratio: Optional[float] = None

# Single chat message with optional media
class ChatMessage(BaseModel):
    sender: str
    text: str
    is_me: bool
    media: Optional[MediaObject] = None

class HistoryResponse(BaseModel):
    username: str
    messages: List[ChatMessage]

class ChatSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    auto_reply: Optional[bool] = None
    # start_conversation REMOVED
    custom_rules: Optional[str] = None

class MessageSend(BaseModel):
    """Schema for sending a message."""
    text: str

class ChatBase(BaseModel):
    """Base schema for a single chat response."""
    id: str
    username: str
    full_name: Optional[str] = None
    last_message: Optional[str] = None
    profile_pic: Optional[str] = None

    class Config:
        orm_mode = True

class ChatSettingsResponse(BaseModel):
    enabled: bool
    auto_reply: bool
    # start_conversation REMOVED
    custom_rules: Optional[str]

    class Config:
        orm_mode = True

class FullChatResponse(ChatBase):
    """Full chat response including settings."""
    settings: Optional[ChatSettingsResponse]
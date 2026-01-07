# backend/schemas.py
from pydantic import BaseModel
from typing import Optional, Any, List, Dict

class ChatSettingsUpdate(BaseModel):
    """Update payload for chat settings"""
    enabled: Optional[bool] = None
    auto_reply: Optional[bool] = None
    custom_rules: Optional[str] = None

class MessageSend(BaseModel):
    """Payload for sending a message"""
    text: str

class ChatSettingsResponse(BaseModel):
    """Chat settings response"""
    enabled: bool
    auto_reply: bool
    custom_rules: Optional[str] = None
    start_conversation: bool = False

class FullChatResponse(BaseModel):
    """Full chat data including settings"""
    id: str
    username: str
    full_name: Optional[str] = None
    last_message: Optional[str] = None
    profile_pic: Optional[str] = None
    settings: Optional[ChatSettingsResponse] = None

class MessageItem(BaseModel):
    """Single message in chat history"""
    sender: str
    text: Optional[str] = None
    is_me: bool
    media: Optional[Dict[str, Any]] = None

class HistoryResponse(BaseModel):
    """Chat history response"""
    username: str
    messages: List[Any]  # Can be MessageItem or dict

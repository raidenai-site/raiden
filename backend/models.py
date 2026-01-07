# backend/models.py
from sqlalchemy import create_engine, Column, Integer, String, Boolean, Text, ForeignKey, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

Base = declarative_base()

class Chat(Base):
    __tablename__ = 'instagram_chats'
    id = Column(String, primary_key=True)  
    username = Column(String)
    full_name = Column(String, nullable=True)
    profile_pic = Column(String, nullable=True)
    last_message = Column(Text, nullable=True)
    last_timestamp = Column(String, nullable=True)
    
    settings = relationship("ChatSettings", back_populates="chat", uselist=False, cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")
    profile = relationship("UserProfile", back_populates="chat", uselist=False, cascade="all, delete-orphan")

class ChatSettings(Base):
    __tablename__ = 'tracked_instagram_chats'
    chat_id = Column(String, ForeignKey('instagram_chats.id'), primary_key=True)
    
    # Raiden ON/OFF. If False, we ignore new messages.
    enabled = Column(Boolean, default=False)
    
    # If True, we reply instantly. If False, we just suggest (send to UI).
    auto_reply = Column(Boolean, default=False) 
    
    # REMOVED: start_conversation (It's an action button now)
    
    custom_rules = Column(Text, nullable=True)
    last_synced = Column(DateTime, default=datetime.utcnow)
    
    chat = relationship("Chat", back_populates="settings")

class Message(Base):
    __tablename__ = 'instagram_messages'
    id = Column(Integer, primary_key=True, autoincrement=True)
    chat_id = Column(String, ForeignKey('instagram_chats.id'))
    sender = Column(String)
    message_text = Column(Text)
    timestamp = Column(String)
    chat = relationship("Chat", back_populates="messages")

class UserProfile(Base):
    __tablename__ = 'user_profiles'
    chat_id = Column(String, ForeignKey('instagram_chats.id'), primary_key=True)
    profile_data = Column(Text, nullable=False) 
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    chat = relationship("Chat", back_populates="profile")

# ============================================================
# AI ASSISTANT CHAT MEMORY
# ============================================================

class AIConversation(Base):
    """Stores AI assistant conversation sessions"""
    __tablename__ = 'ai_conversations'
    id = Column(String, primary_key=True)  # UUID
    title = Column(String, default="New Chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    messages = relationship("AIMessage", back_populates="conversation", 
                          cascade="all, delete-orphan", order_by="AIMessage.created_at")

class AIMessage(Base):
    """Stores individual messages in AI conversations"""
    __tablename__ = 'ai_messages'
    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(String, ForeignKey('ai_conversations.id'))
    role = Column(String)  # "user" or "assistant"
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    conversation = relationship("AIConversation", back_populates="messages")

# ============================================================
# RATE LIMITING
# ============================================================

class RateLimitState(Base):
    """Local rate limit tracking for LLM requests"""
    __tablename__ = 'rate_limit_state'
    id = Column(Integer, primary_key=True)  # Always ID=1 (single row)
    request_count = Column(Integer, default=0)
    window_start = Column(DateTime, default=datetime.utcnow)
    cooldown_until = Column(DateTime, nullable=True)  # Set when limit is exceeded

# Get data directory (same as db2.py)
import os
from pathlib import Path

def _get_data_dir() -> Path:
    """Get the data directory for storing databases"""
    if os.name == 'nt':  # Windows
        base = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
    else:
        base = Path.home() / '.local' / 'share'
    
    data_dir = base / 'Raiden'
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

_db_path = _get_data_dir() / "raiden.db"
engine = create_engine(f'sqlite:///{_db_path}', connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()
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

engine = create_engine('sqlite:///raiden.db', connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()
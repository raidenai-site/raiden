# backend/user_profile.py
"""
User typing profile generation using Supabase Edge Functions.
API keys are secured server-side - no direct AI calls from client.
"""

import json
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from backend.models import UserProfile, ChatSettings, SessionLocal
from backend.edge_client import generate_profile_via_edge


def get_profile(chat_id: str) -> Optional[Dict[str, Any]]:
    """Get cached profile from database."""
    db = SessionLocal()
    try:
        profile = db.query(UserProfile).filter(UserProfile.chat_id == chat_id).first()
        if profile and profile.profile_data:
            try:
                return profile.profile_data if isinstance(profile.profile_data, dict) else json.loads(profile.profile_data)
            except:
                return None
        return None
    finally:
        db.close()


async def generate_profile(
    chat_id: str, 
    bot, 
    message_limit: int = 200, 
    force_refresh: bool = False,
    auth_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Generate or retrieve a typing profile for a chat.
    
    Args:
        chat_id: The chat/conversation identifier
        bot: The Instagram bot instance for fetching history
        message_limit: Number of messages to analyze
        force_refresh: If True, regenerate even if cached
        auth_token: JWT token for authenticating with edge function
    
    Returns:
        Profile dict, or None on error
    """
    # 1. CACHE CHECK: If exists and not forcing update, return immediately
    if not force_refresh:
        existing = get_profile(chat_id)
        if existing:
            print(f"✅ Profile exists for {chat_id}. Returning cached.")
            return existing

    print(f"🧠 Generating NEW profile for: {chat_id}")
    
    history = await bot.get_chat_history(chat_id=chat_id, limit=message_limit)
    if not history:
        print("⚠️ No history found.")
        return None

    # Format message objects into transcript strings
    def format_message(msg):
        if isinstance(msg, dict):
            sender = msg.get("sender", "Unknown")
            text = msg.get("text", "")
            media = msg.get("media")
            if media and not text:
                return f"{sender}: [Shared {media.get('type', 'media')}]"
            elif media:
                return f"{sender}: {text} [Shared {media.get('type', 'media')}]"
            return f"{sender}: {text}"
        return str(msg)
    
    transcript = "\n".join(format_message(m) for m in history)

    # 2. Call Edge Function (secure - API key stays server-side)
    profile_dict = await generate_profile_via_edge(
        transcript=transcript,
        auth_token=auth_token
    )
    
    if not profile_dict:
        print(f"❌ Failed to generate profile via edge function")
        return None

    # 3. Save to database
    db = SessionLocal()
    try:
        json_string = json.dumps(profile_dict)

        existing_row = db.query(UserProfile).filter(UserProfile.chat_id == chat_id).first()
        if existing_row:
            existing_row.profile_data = json_string
            existing_row.updated_at = datetime.utcnow()
        else:
            db.add(UserProfile(chat_id=chat_id, profile_data=json_string))

        db.commit()
        print("✅ Profile saved.")
        return profile_dict

    except Exception as e:
        print(f"❌ Error saving profile: {e}")
        return profile_dict  # Still return the profile even if save fails
    finally:
        db.close()
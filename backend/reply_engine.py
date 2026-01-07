# backend/reply_engine.py
"""
Reply generation using Supabase Edge Functions.
API keys are secured server-side - no direct AI calls from client.
Uses DB history for context instead of semantic search.
"""

from typing import Optional, Any
from backend.models import SessionLocal, ChatSettings
from backend.user_profile import generate_profile
from backend.edge_client import generate_reply_via_edge


def _get_writing_examples(limit: int = 20) -> str:
    """Get examples of my past messages for style matching"""
    try:
        from backend.db2 import get_my_messages
        my_messages = get_my_messages(limit=limit)
        if my_messages:
            examples = "\n".join(f"- {msg}" for msg in my_messages[:limit])
            return examples
    except Exception as e:
        print(f"⚠️ Could not get writing examples: {e}")
    return ""


async def generate_smart_reply(
    chat_id: str, 
    bot: Any, 
    history_limit: int = 15, 
    is_starter: bool = False,
    auth_token: Optional[str] = None
) -> Optional[str]:
    """
    Generate a smart reply using the Supabase Edge Function.
    
    Context fields passed to AI:
    1. transcript - Recent chat messages (from live scrape)
    2. profile - User's typing style profile
    3. rules - Custom rules for this chat (highest priority)
    4. writing_examples - My past messages for style matching
    5. relevant_context - Last 75 messages from the DB (for long-term memory)
    
    Args:
        chat_id: The chat/conversation identifier
        bot: The Instagram bot instance for fetching history
        history_limit: Number of messages to include in context
        is_starter: If True, generates a conversation starter instead of reply
        auth_token: JWT token for authenticating with edge function
    
    Returns:
        Generated reply text, or None on error
    """
    
    # 1. Get Profile
    profile_dict = await generate_profile(chat_id, bot, auth_token=auth_token)
    if not profile_dict: 
        return None

    # 2. Get Live Chat Context (recent messages from browser)
    raw_history = await bot.get_chat_history(chat_id=chat_id, limit=history_limit)
    
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
    
    transcript = "\n".join(format_message(m) for m in raw_history) if raw_history else "(No recent history)"

    # 3. Get Custom Rules
    db = SessionLocal()
    settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
    rules = settings.custom_rules if settings and settings.custom_rules else None
    db.close()

    # 4. Get Writing Examples (my past messages for style)
    writing_examples = _get_writing_examples(limit=30)
    
    # 5. Get Past Context (Last 75 messages + Keyword Search)
    relevant_context = ""
    try:
        from backend.db2 import get_messages_by_chat, search_keyword
        
        context_lines = []
        seen_message_ids = set()
        
        # A. Last 75 Messages (Recent History)
        past_msgs = get_messages_by_chat(chat_id, limit=75)
        
        if past_msgs:
            context_lines.append("Past messages with the user (Recent History):")
            for m in past_msgs:
                seen_message_ids.add(m["message_id"])
                sender = m.get("sender", "Unknown")
                text = m.get("text", "")
                context_lines.append(f"[{sender}]: {text}")
            print(f"📖 [CONTEXT] Added {len(past_msgs)} recent messages from DB")

        # B. Keyword Search (Topic Context)
        # Find last message from "Them" to use as query
        search_query = None
        if raw_history:
            for msg in reversed(raw_history):
                # Check for dictionary and ensure it's not from me
                if isinstance(msg, dict):
                    text = msg.get("text", "")
                    if text and len(text) > 4: # Only search if substantial enough
                        search_query = text
                        break
        
        if search_query:
            # Extract keywords (>3 chars)
            keywords = [w for w in search_query.split() if len(w) > 3]
            keyword_matches = []
            
            # Search top 3 keywords
            for kw in keywords[:3]:
                # Search within this chat
                results = search_keyword(kw, chat_id=chat_id, limit=5)
                for r in results:
                    if r["message_id"] not in seen_message_ids:
                        seen_message_ids.add(r["message_id"])
                        keyword_matches.append(r)
            
            if keyword_matches:
                context_lines.append("\nRelated past messages (Keyword Match):")
                for m in keyword_matches:
                    sender = m.get("sender", "Unknown")
                    text = m.get("text", "")
                    context_lines.append(f"[{sender}]: {text}")
                print(f"🔍 [CONTEXT] Added {len(keyword_matches)} keyword matches for '{search_query[:20]}...'")

        if context_lines:
            relevant_context = "\n".join(context_lines)
            
    except Exception as e:
        print(f"⚠️ Failed to get past context: {e}")

    # 6. Call Edge Function (secure - API key stays server-side)
    reply = await generate_reply_via_edge(
        chat_id=chat_id,
        transcript=transcript,
        profile=profile_dict,
        rules=rules,
        writing_examples=writing_examples,
        is_starter=is_starter,
        auth_token=auth_token,
        relevant_context=relevant_context
    )
    
    if reply:
        print(f"🤖 Generated {'STARTER' if is_starter else 'REPLY'} for {chat_id}: {reply}")
    
    return reply

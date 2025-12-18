import json
import os
import re
from datetime import datetime
from typing import Optional, Dict, Any
from dotenv import load_dotenv
import google.generativeai as genai
from sqlalchemy.orm import Session
from backend.models import UserProfile, ChatSettings, SessionLocal

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY not set")

genai.configure(api_key=GEMINI_API_KEY)
MODEL = genai.GenerativeModel("gemini-2.5-flash")
GENERATION_CONFIG = {"temperature": 0.4, "max_output_tokens": 2048, "response_mime_type": "application/json"}

def _clean_json(text: str) -> str:
    text = re.sub(r"```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"```\s*$", "", text, flags=re.IGNORECASE).strip()
    # Try to fix common JSON issues
    # Remove trailing commas before closing braces/brackets
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text

def _try_parse_json(text: str) -> Optional[Dict[str, Any]]:
    """Try to parse JSON with multiple fallback strategies"""
    cleaned = _clean_json(text)
    
    # Try direct parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    
    # Try to extract JSON object from text
    try:
        match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', cleaned, re.DOTALL)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    
    # Try to fix unterminated strings by finding the last valid JSON
    try:
        # Find the last complete key-value pair and close the object
        lines = cleaned.split('\n')
        for i in range(len(lines), 0, -1):
            partial = '\n'.join(lines[:i])
            # Count braces to try to close properly
            open_braces = partial.count('{') - partial.count('}')
            if open_braces > 0:
                partial = partial.rstrip(',\n ') + '\n' + '}' * open_braces
                try:
                    return json.loads(partial)
                except:
                    continue
    except:
        pass
    
    return None

def get_profile(chat_id: str) -> Optional[Dict[str, Any]]:
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

async def generate_profile(chat_id: str, bot, message_limit: int = 200, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
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
    # Each message is now {sender, text, is_me, media}
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

    db = SessionLocal()
    try:
        settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
        rules = settings.custom_rules if settings else "None"

        prompt = f"""
        Your task is to generate a TYPING-MECHANICS JSON ONLY for the user labeled "Me". Do not include details for any other user in the JSON.

        ### STRICT BOUNDARIES
        - **NO PERSONALITY ANALYSIS:** Do not use words like polite, rude, sarcastic, angry, happy, shy, or aggressive.
        - **NO PSYCHOLOGY:** Do not infer intent or feelings.
        - **ONLY MECHANICS:** Focus exclusively on keystrokes, grammar, formatting, and syntax.

        ### DATA TO ANALYZE
        TRANSCRIPT:
        {transcript}

        ### OUTPUT FORMAT
        Return valid JSON only:
        {{
            "casing_style": "Exact rule (e.g., 'strictly lowercase', 'start case', 'random caps for emphasis')",
            "punctuation_habits": "Exact rule (e.g., 'no periods', 'spaces before question marks', 'multiple exclamations')",
            "grammar_level": "Observation (e.g., 'perfect grammar', 'ignores apostrophes in contractions', 'run-on sentences')",
            "message_structure": "Observation (e.g., 'single long blocks', 'rapid-fire short bursts', 'uses line breaks')",
            "emoji_mechanics": "Rule (e.g., 'replaces words with emojis', 'end of sentence only', 'never uses them')",
            "common_abbreviations": ["list", "specific", "shorthands", "like", "rn", "u", "idk"],
            "syntax_quirks": "Specific patterns (e.g., 'uses ellipses... a lot', 'starts messages with 'so'', 'never says goodbye')"
        }}
        """

        # Try up to 2 times in case of malformed JSON
        profile_dict = None
        for attempt in range(2):
            response = await MODEL.generate_content_async(prompt, generation_config=GENERATION_CONFIG)
            profile_dict = _try_parse_json(response.text)
            if profile_dict:
                break
            print(f"⚠️ JSON parse failed (attempt {attempt + 1}), retrying...")
        
        if not profile_dict:
            print(f"❌ Failed to parse JSON after retries. Raw: {response.text[:500]}")
            return None
            
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
        print(f"❌ Generation Error: {e}")
        return None
    finally:
        db.close()
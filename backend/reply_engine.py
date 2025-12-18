# backend/reply_engine.py
import os
import json
from typing import Optional, Any
from dotenv import load_dotenv
import google.generativeai as genai
from backend.models import SessionLocal, ChatSettings
from backend.user_profile import generate_profile, get_profile

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY: raise RuntimeError("GEMINI_API_KEY not set")

genai.configure(api_key=GEMINI_API_KEY)
MODEL = genai.GenerativeModel("gemini-2.5-flash")
REPLY_CONFIG = {"temperature": 0.7, "max_output_tokens": 150} # Higher temp for starters

async def generate_smart_reply(
    chat_id: str, 
    bot: Any, 
    history_limit: int = 15, 
    is_starter: bool = False  # <--- NEW FLAG
) -> Optional[str]:
    
    # 1. Get Profile
    profile_dict = await generate_profile(chat_id, bot)
    if not profile_dict: return None

    # 2. Get Context
    raw_history = await bot.get_chat_history(chat_id=chat_id, limit=history_limit)
    
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
    
    transcript = "\n".join(format_message(m) for m in raw_history) if raw_history else "(No recent history)"

    # 3. Get Rules
    db = SessionLocal()
    settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
    rules = settings.custom_rules if settings else "None"
    db.close()

    # 4. Build Prompt
    if is_starter:
        # === MANUAL TRIGGER / VIBE MATCH ENGINE ===
        # Use this when the user clicks "Generate Reply". 
        # It analyzes the CONTEXT and VIBE of "Them" to ensure the reply fits the mood.
        
        prompt = f"""
        You are roleplaying as the user "Me". 
        Your goal is to start or continue the conversation by replying to the user "Them" based on the current context.

        ### 1. Typing Mechanics
        Strictly mimic these writing patterns. Do not deviate.
        {json.dumps(profile_dict, indent=2)}

        ### 2. CONTEXT (The Conversation)
        TRANSCRIPT:
        {transcript}

        CUSTOM RULES: {rules}

        ### 3. INSTRUCTIONS
        **Step 1: Analyze the Vibe & State**
        - Look at "Them's" last message in the transcript.
        - **Context:** What are they talking about?
        - **Vibe Check:** Are they being dry? Hyper? Flirty? Serious? Angry?
        - **Mirroring:** Your reply must MATCH "Them's" energy.
            - If they are dry (short, no punctuation), you be dry.
            - If they are expressive (caps, emojis), you be expressive (within "Me's" profile limits).
        
        **Step 2: Draft the Reply**
        - Formulate a response that naturally follows "Them's" last message.
        - **CRITICAL:** Apply the `casing_style`, `punctuation_habits`, and `abbreviations` from the Profile above.
        - Do NOT sound like an AI assistant. Be brief, human, and imperfect.

        **Step 3: Output**
        - Output ONLY the raw message text. No quotes, no explanations.
        """
    else:
        # === STANDARD REPLY ENGINE ===
        # Use this for auto-replies or standard flow. 
        # Focuses on strict mechanical adherence and speed.

        prompt = f"""
        You are roleplaying as user "Me". 
        GOAL: Reply to the latest message in the transcript.

        ### YOUR IDENTITY (Strict Execution)
        {json.dumps(profile_dict, indent=2)}

        ### TRANSCRIPT
        {transcript}

        ### CUSTOM RULES
        {rules}

        ### INSTRUCTIONS
        **Step 1: Analyze the Vibe & State**
        - Look at "Them's" last message in the transcript.
        - **Context:** What are they talking about?
        - **Vibe Check:** Are they being dry? Hyper? Flirty? Serious? Angry?
        - **Mirroring:** Your reply must MATCH "Them's" energy.
            - If they are dry (short, no punctuation), you be dry.
            - If they are expressive (caps, emojis), you be expressive (within "Me's" profile limits).
        
        ** Draft the Reply**
        - Formulate a response that naturally follows "Them's" last message.
        - **CRITICAL:** Apply the `casing_style`, `punctuation_habits`, and `abbreviations` from the Profile above.
        - Do NOT sound like an AI assistant. Be brief, human, and imperfect.
        """

    try:
        response = await MODEL.generate_content_async(prompt, generation_config=REPLY_CONFIG)
        reply = response.text.strip().replace('"', '').replace("Me:", "")
        print(f"🤖 Generated {'STARTER' if is_starter else 'REPLY'} for {chat_id}: {reply}")
        return reply
    except Exception as e:
        print(f"❌ Gen Error: {e}")
        return None
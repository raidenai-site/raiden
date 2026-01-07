import asyncio
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

# Win32 Fix
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

sys.path.insert(0, str(Path(__file__).parent.parent))

# Import supabase/membership BEFORE backend.websockets to avoid naming conflict
# backend/websockets.py shadows the websockets package that supabase needs
from typing import Optional
from backend.membership import get_user_tier, check_auto_reply_limit, create_user_if_not_exists, get_customer_id
from backend.auth import get_current_user_id, require_auth_token, get_current_auth_token

from worker.platforms.instagram import InstagramBot
from backend.models import get_db, Chat, ChatSettings, AIConversation, AIMessage
from backend.schemas import ChatSettingsUpdate, MessageSend, FullChatResponse, HistoryResponse
from backend.websockets import manager
from backend.user_profile import get_profile, generate_profile
from backend.reply_engine import generate_smart_reply
from backend.assistant import ask_assistant, get_assistant_stats
from backend.db2 import init_db as db2_init
from backend.rate_limiter import format_reset_time  # Keep for formatting
from backend.edge_client import check_rate_limit_via_edge, validate_membership_via_edge
from pydantic import BaseModel

bot_instance: InstagramBot = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_instance
    
    # Initialize db2 (creates tables if they don't exist)
    db2_init()
    
    bot_instance = InstagramBot()
    print("🤖 Backend Initialized.")

    # Auto-start logic
    if bot_instance.has_session():
        print("🍪 Session found. Auto-starting Listener...")
        asyncio.create_task(bot_instance.listen())
    else:
        print("⚠️ No session found. Waiting for user to /login.")

    yield  # <--- The app runs here. Ctrl+C triggers the code below.
    
    print("🛑 Shutting down...")
    
    if bot_instance:
        # THE FIX: Wrap close() in a timeout. 
        # If Playwright hangs, we abandon it after 2 seconds.
        try:
            await asyncio.wait_for(bot_instance.close(), timeout=2.0)
        except asyncio.TimeoutError:
            pass
        except Exception as e:
            print(f"⚠️ Error during shutdown: {e}")

app = FastAPI(lifespan=lifespan, title="Raiden Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_bot():
    if bot_instance is None:
        raise HTTPException(status_code=503, detail="Bot not initialized.")
    return bot_instance

# =======================
# 1. AUTH & SYSTEM
# =======================

@app.get("/auth/status")
async def get_auth_status(
    bot: InstagramBot = Depends(get_bot),
    auth_token: Optional[str] = Depends(get_current_auth_token)
):
    """
    Frontend checks this to know what UI to show.
    - If has_session=True: Show Main App (Inbox).
    - If has_session=False: Show Login Screen.
    
    Also stores auth token for background AI calls if provided.
    """
    print(f"📍 [AUTH STATUS] Called with auth_token={'present' if auth_token else 'None'}")
    
    # Store token for background AI operations (edge functions)
    if auth_token and bot:
        bot.set_auth_token(auth_token)
        print(f"✅ [AUTH STATUS] Token stored in bot!")
    else:
        print(f"⚠️ [AUTH STATUS] No token received")
    
    return {
        "has_session": bot.has_session(),
        "is_active": bot.is_active,  # True if the browser loop is running
        "cookies_ready": bot.cookies_ready  # True after cookie check completes
    }

@app.get("/auth/membership")
async def get_membership_info(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db)
):
    """
    Get user's membership tier and limits.
    Requires authentication.
    """
    tier = await get_user_tier(user_id)
    
    # Get current auto_reply count from local database
    current_count = db.query(ChatSettings).filter(
        ChatSettings.auto_reply == True
    ).count()
    
    limit = 2 if tier == "free" else 5
    
    return {
        "tier": tier,
        "auto_reply_limit": limit,
        "auto_reply_count": current_count,
        "can_enable_more": current_count < limit
    }

@app.post("/auth/login")
async def login_instagram(
    background_tasks: BackgroundTasks, 
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    """
    1. Opens Login Window.
    2. Waits for user to log in.
    3. Saves cookies & Closes Login Window.
    4. IMMEDIATELY starts the Listener (Browser).
    
    Requires authentication (Supabase JWT token).
    """
    # Create user in Supabase if doesn't exist
    await create_user_if_not_exists(user_id)
    
    # Store auth token for background AI calls
    bot.set_auth_token(auth_token)
    
    if bot.is_active:
        return {"status": "already_running"}

    # 1. Run the Setup Login flow (Headed, waits for manual input)
    success = await bot.login()
    
    if success:
        # 2. Login successful? Immediately start the actual Bot Listener
        print("✅ Login confirmed. Starting Listener...")
        background_tasks.add_task(bot.listen)
        return {"status": "login_success"}
    else:
        raise HTTPException(401, detail="Login failed or cancelled.")

@app.post("/auth/logout")
async def logout_instagram(bot: InstagramBot = Depends(get_bot)):
    """
    1. Stops the Listener.
    2. Deletes the Session file.
    """
    await bot.logout()
    return {"status": "logged_out"}

# =======================
# PAYMENTS (DODOPAYMENTS)
# =======================

import os
from dodopayments import DodoPayments

DODO_API_KEY = os.getenv("DODO_API_KEY")
DODO_PRODUCT_ID = "pdt_0NUy5LyHziwEampmeNDga"  # Raiden Pro subscription

@app.post("/payments/create-checkout")
async def create_checkout_session(
    user_id: str = Depends(get_current_user_id)
):
    """
    Create a DodoPayments checkout URL for Pro subscription.
    Returns the checkout URL for frontend to redirect to.
    """
    if not DODO_API_KEY:
        raise HTTPException(500, "Payment system not configured")
    
    try:
        client = DodoPayments(bearer_token=DODO_API_KEY)
        
        # Create checkout session for subscription product
        checkout = client.checkout_sessions.create(
            product_cart=[{
                "product_id": DODO_PRODUCT_ID,
                "quantity": 1
            }],
            return_url="http://localhost:3000?payment=success",
            metadata={
                "user_id": user_id  # Track which user is subscribing
            }
        )
        
        print(f"💳 Created checkout for user {user_id}: {checkout.checkout_url}")
        return {"url": checkout.checkout_url}
        
    except Exception as e:
        print(f"❌ Payment error: {e}")
        raise HTTPException(500, f"Failed to create checkout: {str(e)}")


@app.post("/payments/create-portal")
async def create_portal_session(
    user_id: str = Depends(get_current_user_id)
):
    """
    Create a DodoPayments customer portal session.
    Allows user to manage subscription.
    """
    if not DODO_API_KEY:
        raise HTTPException(500, "Payment system not configured")

    # Get Dodo Customer ID from user_memberships
    customer_id = await get_customer_id(user_id)
    
    if not customer_id:
        raise HTTPException(400, "No active subscription found. Please upgrade first.")

    try:
        client = DodoPayments(bearer_token=DODO_API_KEY)
        
        # Create portal session
        session = client.customers.customer_portal.create(
            customer_id=customer_id
        )
        
        return {"url": session.link}
        
    except Exception as e:
        print(f"❌ Portal error: {e}")
        raise HTTPException(500, f"Failed to create portal session: {str(e)}")

# =======================
# RATE LIMIT STATUS
# =======================

@app.get("/rate-limit/status")
async def get_rate_limit_status_endpoint():
    """
    Get current rate limit status.
    Returns current count, max requests, window info, and cooldown state.
    """
    return get_rate_limit_status()

# =======================
# GLOBAL AUTO-REPLY
# =======================

from backend.db import SessionManager
from pydantic import BaseModel

class GlobalEnableRequest(BaseModel):
    global_rules: str = ""

def get_global_settings_from_file() -> dict:
    """Read global settings from sessions.json"""
    sm = SessionManager()
    data = sm.get_session("global")
    if data:
        return data
    return {"auto_reply_all": False, "global_rules": ""}

def save_global_settings_to_file(settings: dict) -> None:
    """Save global settings to sessions.json"""
    sm = SessionManager()
    sm.save_session("global", settings)

@app.get("/global/settings")
async def get_global_settings():
    """Get current global auto-reply state"""
    return get_global_settings_from_file()

class GlobalRulesUpdate(BaseModel):
    global_rules: str

@app.put("/global/rules")
async def update_global_rules(request: GlobalRulesUpdate):
    """Update global rules without changing auto_reply_all state"""
    current = get_global_settings_from_file()
    save_global_settings_to_file({
        "auto_reply_all": current.get("auto_reply_all", False),
        "global_rules": request.global_rules
    })
    print(f"📝 Global rules updated: {request.global_rules[:50]}...")
    return {"status": "updated", "global_rules": request.global_rules}

@app.post("/global/enable-all")
async def enable_all_chats(
    request: GlobalEnableRequest,
    db: Session = Depends(get_db),
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id)
):
    """
    Enable AI + auto-reply for ALL chats with global rules.
    PRO FEATURE - requires paid tier.
    1. Save global state (auto_reply_all=True, global_rules)
    2. For ALL chats in sidebar, set enabled=True, auto_reply=True, custom_rules=global_rules
    3. Refresh tracked cache
    4. Broadcast sidebar update
    """
    # Check if user is Pro
    tier = await get_user_tier(user_id)
    if tier != "paid":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "pro_required",
                "message": "Auto Reply ALL is a Pro feature. Upgrade to unlock!"
            }
        )
    
    if not bot.is_active:
        raise HTTPException(503, "Bot not active.")
    
    # 1. Save global state
    save_global_settings_to_file({
        "auto_reply_all": True,
        "global_rules": request.global_rules
    })
    print(f"🌐 Global Auto-Reply ENABLED with rules: {request.global_rules[:50]}...")
    
    # 2. Get all chats from inbox and update settings
    inbox = await bot.get_inbox()
    updated_count = 0
    
    for item in inbox:
        chat_id = item["id"]
        
        # Ensure Chat record exists
        chat_exists = db.query(Chat).filter(Chat.id == chat_id).first()
        if not chat_exists:
            new_chat = Chat(id=chat_id, username=chat_id, full_name=item.get("name"))
            db.add(new_chat)
            db.commit()
        
        # Get or create ChatSettings
        settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
        if not settings:
            settings = ChatSettings(chat_id=chat_id)
            db.add(settings)
        
        # Update settings
        settings.enabled = True
        settings.auto_reply = True
        
        # Only set global rules if chat has NO custom rules (preserve user-set rules)
        if not settings.custom_rules:
            settings.custom_rules = request.global_rules
        
        updated_count += 1
    
    db.commit()
    
    # 3. Refresh cache
    bot.refresh_cache()
    
    # 4. Broadcast sidebar update (trigger frontend refresh)
    await manager.broadcast("sidebar", {
        "event": "global_state_changed",
        "auto_reply_all": True,
        "updated_count": updated_count
    })
    
    print(f"✅ Enabled AI for {updated_count} chats")
    return {"status": "enabled", "updated_count": updated_count}

@app.post("/global/disable-all")
async def disable_all_chats(
    db: Session = Depends(get_db),
    bot: InstagramBot = Depends(get_bot)
):
    """
    Disable AI for ALL chats.
    1. Save global state (auto_reply_all=False)
    2. For ALL chats with settings, set enabled=False, auto_reply=False
    3. Clear tracked cache
    4. Broadcast sidebar update
    """
    # 1. Save global state
    current = get_global_settings_from_file()
    save_global_settings_to_file({
        "auto_reply_all": False,
        "global_rules": current.get("global_rules", "")  # Keep rules for next time
    })
    print("🌐 Global Auto-Reply DISABLED")
    
    # 2. Disable all chats
    all_settings = db.query(ChatSettings).all()
    updated_count = 0
    global_rules = current.get("global_rules", "")
    
    for settings in all_settings:
        settings.enabled = False
        settings.auto_reply = False
        
        # Only clear custom_rules if they match global rules (meaning they came from global)
        # User-edited/custom rules are preserved
        if settings.custom_rules == global_rules:
            settings.custom_rules = None
        
        updated_count += 1
    
    db.commit()
    
    # 3. Refresh cache (will be empty)
    if bot.is_active:
        bot.refresh_cache()
    
    # 4. Broadcast sidebar update
    await manager.broadcast("sidebar", {
        "event": "global_state_changed",
        "auto_reply_all": False,
        "updated_count": updated_count
    })
    
    print(f"✅ Disabled AI for {updated_count} chats")
    return {"status": "disabled", "updated_count": updated_count}

# =======================
# 2. CHAT DATA
# =======================


@app.get("/instagram/chats", response_model=list[FullChatResponse])
async def get_chats(
    db: Session = Depends(get_db), 
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    """
    Get list of Instagram chats.
    Requires authentication.
    """
    # Store token for background AI operations
    if auth_token:
        bot.set_auth_token(auth_token)
    
    # Guard: If bot isn't running yet (e.g. startup delay), return error or empty
    if not bot.is_active:
         raise HTTPException(503, "Bot is starting up or not logged in.")

    inbox = await bot.get_inbox()
    result = []
    
    for item in inbox:
        chat_data = {
            "id": item["id"],
            "username": item["name"],
            "full_name": item["name"],
            "last_message": item["preview"],
            "profile_pic": item.get("profile_pic", ""),
        }
        
        settings = db.query(ChatSettings).filter(ChatSettings.chat_id == item["id"]).first()
        if settings:
            chat_data["settings"] = {
                "enabled": settings.enabled,
                "auto_reply": settings.auto_reply,
                "custom_rules": settings.custom_rules,
                "start_conversation": False
            }
        else:
            chat_data["settings"] = None
        
        result.append(chat_data)

    return result

@app.get("/chats/{chat_id}/history", response_model=HistoryResponse)
async def get_chat_history_endpoint(chat_id: str):
    if not bot_instance.is_active:
        raise HTTPException(status_code=503, detail="Bot not active.")

    history = await bot_instance.get_chat_history(chat_id=chat_id)
    if not history:
        raise HTTPException(status_code=404, detail="Chat empty or not found.")

    # PRE-POPULATE sent_message_ids when user opens a chat
    # This establishes baseline BEFORE listener detects changes (prevents duplicate broadcasts)
    if chat_id not in bot_instance.sent_message_ids:
        bot_instance.sent_message_ids[chat_id] = set()
    for msg in history:
        if isinstance(msg, dict) and msg.get("message_id"):
            bot_instance.sent_message_ids[chat_id].add(msg["message_id"])
    print(f"📋 [HTTP] Pre-loaded {len(bot_instance.sent_message_ids[chat_id])} message IDs for {chat_id}")

    # History is now a list of message objects with sender, text, is_me, media
    return {
        "username": chat_id,
        "messages": history
    }

# =======================
# 3. ACTIONS & SETTINGS
# =======================

@app.get("/instagram/chat/{chat_id}/settings")
async def get_chat_settings(chat_id: str, db: Session = Depends(get_db)):
    settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
    
    if settings:
        return {
            "enabled": settings.enabled,
            "auto_reply": settings.auto_reply,
            "custom_rules": settings.custom_rules,
        }
    else:
        return {
            "enabled": False,
            "auto_reply": False,
            "custom_rules": None,
        }

@app.patch("/instagram/chat/{chat_id}/settings")
async def update_chat_settings(
    chat_id: str, 
    updates: ChatSettingsUpdate, 
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Update chat settings.
    Requires authentication.
    Enforces tracking limits based on user tier.
    """
    # Get user tier from Supabase
    tier = await get_user_tier(user_id)
    print(f"📊 Settings update for {chat_id}: user={user_id}, tier={tier}, updates={updates.dict(exclude_unset=True)}")
    
    # If trying to enable tracking, check limit
    if updates.enabled is True:
        # Use the cached count from bot_instance (same as "Cache Updated: X tracked chats")
        current_count = len(bot_instance.tracked_cache) if bot_instance else 0
        print(f"🔢 Tracked chats count (from cache): {current_count}")
        
        # Check if this chat is already in the cache (doesn't count toward limit)
        if chat_id in (bot_instance.tracked_cache if bot_instance else set()):
            # Already enabled, no limit check needed
            print(f"✅ Chat already tracked, skipping limit check")
            pass
        else:
            # Check limit
            is_allowed, count, limit = check_auto_reply_limit(tier, current_count)
            print(f"🛡️ Limit check: is_allowed={is_allowed}, count={count}, limit={limit}")
            if not is_allowed:
                print(f"❌ LIMIT REACHED! Blocking tracking enable")
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "limit_reached",
                        "message": f"You've reached your tracking limit ({count}/{limit}). Upgrade to unlock more chats.",
                        "current_count": count,
                        "limit": limit,
                        "tier": tier
                    }
                )
    
    settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
    
    if not settings:
        chat_exists = db.query(Chat).filter(Chat.id == chat_id).first()
        if not chat_exists:
            new_chat = Chat(id=chat_id, username=chat_id)
            db.add(new_chat)
            db.commit()
        settings = ChatSettings(chat_id=chat_id)
        db.add(settings)
    
    # Enforce AI/Auto-pilot dependency:
    # 1. If disabling AI (enabled=False), also disable auto_reply
    # 2. If enabling auto_reply, also enable AI
    update_dict = updates.dict(exclude_unset=True)
    
    if update_dict.get("enabled") is False:
        # Turning AI off → also turn off auto-pilot
        update_dict["auto_reply"] = False
        print(f"🔗 AI disabled → auto-disabling auto_reply")
    
    if update_dict.get("auto_reply") is True:
        # Turning auto-pilot on → ensure AI is also on
        if not settings.enabled:
            update_dict["enabled"] = True
            print(f"🔗 auto_reply enabled → auto-enabling AI")
    
    for key, value in update_dict.items():
        setattr(settings, key, value)
    
    db.commit()
    
    if bot_instance and bot_instance.is_active:
        bot_instance.refresh_cache()
        
    return {"status": "updated", "chat_id": chat_id}

@app.post("/instagram/chat/{chat_id}/send")
async def send_message_endpoint(chat_id: str, message: MessageSend, bot: InstagramBot = Depends(get_bot)):
    # Split by newlines for multiple messages
    messages_to_send = [m.strip() for m in message.text.split('\n') if m.strip()]
    
    for i, msg in enumerate(messages_to_send):
        success = await bot.send_message(chat_id, msg)
        if not success:
            raise HTTPException(status_code=500, detail=f"Failed to send message {i+1}.")
        if i < len(messages_to_send) - 1:
            await asyncio.sleep(0.5)  # Small delay between messages
    
    return {"status": "sent", "text": message.text, "message_count": len(messages_to_send)}

@app.post("/instagram/chat/{chat_id}/start")
async def start_conversation_endpoint(
    chat_id: str, 
    db: Session = Depends(get_db), 
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    if not bot.is_active:
         raise HTTPException(503, "Bot offline.")

    # Get user tier via edge function
    membership = await validate_membership_via_edge(auth_token)
    tier = membership.get("tier", "free")
    
    # Check rate limit via edge function
    rate_check = await check_rate_limit_via_edge(action="check", tier=tier, auth_token=auth_token)
    if not rate_check.get("allowed", True):
        reset_at = rate_check.get("reset_at", "")
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Rate limit reached. Try again later.",
                "reset_at": reset_at,
            }
        )

    # Send generating state
    await manager.broadcast(f"chat_{chat_id}", {
        "event": "log",
        "type": "generating",
        "text": "Generating conversation starter..."
    })

    print(f"🚀 Starting conversation with {chat_id}...")
    starter_msg = await generate_smart_reply(chat_id, bot, history_limit=500, is_starter=True, auth_token=auth_token)
    
    # Increment rate limit counter after successful generation
    if starter_msg:
        await check_rate_limit_via_edge(action="increment", tier=tier, auth_token=auth_token)
    
    if not starter_msg:
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "clear"
        })
        raise HTTPException(500, "AI failed to generate starter.")

    # Check auto_reply setting
    settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
    auto_send = settings.auto_reply if settings else False

    if auto_send:
        # Auto-reply ON: send directly
        # Split by newlines for multiple messages
        messages_to_send = [m.strip() for m in starter_msg.split('\n') if m.strip()]
        
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "sending",
            "text": f"Sending {len(messages_to_send)} message(s)..."
        })
        
        for i, msg in enumerate(messages_to_send):
            sent = await bot.send_message(chat_id, msg)
            if not sent:
                raise HTTPException(500, f"Failed to send message {i+1}.")
            if i < len(messages_to_send) - 1:
                await asyncio.sleep(0.5)  # Small delay between messages
        
        # Clear log after delay
        await asyncio.sleep(2)
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "clear"
        })
        return {"status": "sent", "text": starter_msg, "message_count": len(messages_to_send)}
    else:
        # Auto-reply OFF: show as suggestion
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "suggestion",
            "text": starter_msg
        })
        return {"status": "suggested", "text": starter_msg}

@app.post("/instagram/chat/{chat_id}/regenerate")
async def regenerate_suggestion_endpoint(
    chat_id: str, 
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    """Regenerate AI suggestion for a chat"""
    if not bot.is_active:
        raise HTTPException(503, "Bot offline.")

    # Get user tier via edge function
    membership = await validate_membership_via_edge(auth_token)
    tier = membership.get("tier", "free")
    
    # Check rate limit via edge function
    rate_check = await check_rate_limit_via_edge(action="check", tier=tier, auth_token=auth_token)
    if not rate_check.get("allowed", True):
        reset_at = rate_check.get("reset_at", "")
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Rate limit reached. Try again later.",
                "reset_at": reset_at,
            }
        )

    # Send generating state
    await manager.broadcast(f"chat_{chat_id}", {
        "event": "log",
        "type": "generating",
        "text": "Regenerating reply..."
    })

    reply = await generate_smart_reply(chat_id, bot, auth_token=auth_token)
    
    # Increment rate limit counter after successful generation
    if reply:
        await check_rate_limit_via_edge(action="increment", tier=tier, auth_token=auth_token)
    
    if not reply:
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "clear"
        })
        raise HTTPException(500, "AI failed to generate reply.")

    # Send new suggestion
    await manager.broadcast(f"chat_{chat_id}", {
        "event": "log",
        "type": "suggestion",
        "text": reply
    })

    return {"status": "regenerated", "text": reply}

# =======================
# 4. PROFILES & WS
# =======================

@app.get("/instagram/chat/{chat_id}/profile")
async def get_chat_profile_endpoint(chat_id: str):
    profile_data = get_profile(chat_id)
    if not profile_data:
        raise HTTPException(status_code=404, detail="Profile not generated yet.")
    return profile_data

class ProfileUpdateRequest(BaseModel):
    profile_data: dict

@app.patch("/instagram/chat/{chat_id}/profile")
async def update_chat_profile_endpoint(chat_id: str, request: ProfileUpdateRequest, db: Session = Depends(get_db)):
    """Update the user profile with custom data."""
    from backend.models import UserProfile
    import json
    
    profile = db.query(UserProfile).filter(UserProfile.chat_id == chat_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found. Generate one first.")
    
    profile.profile_data = json.dumps(request.profile_data)
    db.commit()
    
    print(f"✏️ Profile updated for {chat_id}")
    return {"status": "updated", "chat_id": chat_id}

@app.post("/instagram/chat/{chat_id}/profile/generate")
async def generate_chat_profile_endpoint(
    chat_id: str, 
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    if not bot.is_active:
         raise HTTPException(status_code=503, detail="Bot not active.")
    
    # Get user tier via edge function
    membership = await validate_membership_via_edge(auth_token)
    tier = membership.get("tier", "free")
    
    # Check rate limit via edge function
    rate_check = await check_rate_limit_via_edge(action="check", tier=tier, auth_token=auth_token)
    if not rate_check.get("allowed", True):
        reset_at = rate_check.get("reset_at", "")
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Rate limit reached. Try again later.",
                "reset_at": reset_at,
            }
        )
         
    profile_data = await generate_profile(chat_id=chat_id, bot=bot, force_refresh=True, auth_token=auth_token)
    
    # Increment rate limit counter after successful generation
    if profile_data:
        await check_rate_limit_via_edge(action="increment", tier=tier, auth_token=auth_token)
    
    if not profile_data:
        raise HTTPException(status_code=500, detail="Failed to generate profile.")
    return profile_data

@app.websocket("/ws/{room_type}/{chat_id}")
async def websocket_endpoint(websocket: WebSocket, room_type: str, chat_id: str):
    room_name = "sidebar" if room_type == "sidebar" else f"chat_{chat_id}"
    await manager.connect(websocket, room_name)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_name)

# ============================================================
# AI ASSISTANT ENDPOINTS
# ============================================================

class AssistantAskRequest(BaseModel):
    question: str

@app.post("/assistant/ask")
async def assistant_ask_endpoint(
    request: AssistantAskRequest,
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    """
    Ask the AI Assistant a question about your conversations.
    The assistant has access to your message history and can search semantically.
    """
    # Get user tier via edge function
    membership = await validate_membership_via_edge(auth_token)
    tier = membership.get("tier", "free")
    
    # Check rate limit via edge function
    rate_check = await check_rate_limit_via_edge(action="check", tier=tier, auth_token=auth_token)
    if not rate_check.get("allowed", True):
        reset_at = rate_check.get("reset_at", "")
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Rate limit reached. Try again later.",
                "reset_at": reset_at,
            }
        )
    
    try:
        result = await ask_assistant(
            question=request.question,
            bot=bot if bot and bot.is_active else None,
            auth_token=auth_token
        )
        
        # Increment rate limit counter after successful response
        await check_rate_limit_via_edge(action="increment", tier=tier, auth_token=auth_token)
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Assistant error: {str(e)}")

@app.get("/assistant/stats")
async def assistant_stats_endpoint():
    """
    Get statistics about stored messages available to the assistant.
    """
    try:
        # Initialize db2 if needed
        db2_init()
        return get_assistant_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats error: {str(e)}")

# ============================================================
# AI ASSISTANT - CONVERSATION MEMORY
# ============================================================

import uuid

class ConversationMessageRequest(BaseModel):
    content: str

@app.get("/assistant/conversations")
async def list_conversations(db: Session = Depends(get_db)):
    """
    List all AI conversations (for sidebar).
    Returns id, title, and updated_at sorted by most recent.
    """
    conversations = db.query(AIConversation).order_by(AIConversation.updated_at.desc()).all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "created_at": c.created_at.isoformat() if c.created_at else None
        }
        for c in conversations
    ]

@app.post("/assistant/conversations")
async def create_conversation(db: Session = Depends(get_db)):
    """
    Create a new AI conversation.
    Returns the new conversation with a default title.
    """
    conversation = AIConversation(
        id=str(uuid.uuid4()),
        title="New Chat"
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    
    return {
        "id": conversation.id,
        "title": conversation.title,
        "created_at": conversation.created_at.isoformat() if conversation.created_at else None
    }

@app.get("/assistant/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """
    Get a conversation with all its messages.
    """
    conversation = db.query(AIConversation).filter(AIConversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {
        "id": conversation.id,
        "title": conversation.title,
        "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
        "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None
            }
            for m in conversation.messages
        ]
    }

@app.delete("/assistant/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, db: Session = Depends(get_db)):
    """
    Delete a conversation and all its messages.
    """
    conversation = db.query(AIConversation).filter(AIConversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    db.delete(conversation)
    db.commit()
    
    return {"status": "deleted", "id": conversation_id}

class RenameConversationRequest(BaseModel):
    title: str

@app.patch("/assistant/conversations/{conversation_id}")
async def rename_conversation(
    conversation_id: str,
    request: RenameConversationRequest,
    db: Session = Depends(get_db)
):
    """
    Rename a conversation.
    """
    conversation = db.query(AIConversation).filter(AIConversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    conversation.title = request.title
    db.commit()
    db.refresh(conversation)
    
    return {
        "id": conversation.id,
        "title": conversation.title,
        "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None
    }

@app.post("/assistant/conversations/{conversation_id}/messages")
async def send_conversation_message(
    conversation_id: str,
    request: ConversationMessageRequest,
    db: Session = Depends(get_db),
    bot: InstagramBot = Depends(get_bot),
    user_id: str = Depends(get_current_user_id),
    auth_token: str = Depends(require_auth_token)
):
    """
    Send a message in a conversation and get AI response.
    Auto-generates conversation title after first exchange.
    """
    # Get user's tier via edge function
    membership = await validate_membership_via_edge(auth_token)
    tier = membership.get("tier", "free")
    
    # Check rate limit via edge function
    rate_check = await check_rate_limit_via_edge(action="check", tier=tier, auth_token=auth_token)
    if not rate_check.get("allowed", True):
        reset_at = rate_check.get("reset_at", "")
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Rate limit reached. Try again later.",
                "reset_at": reset_at,
            }
        )
    
    conversation = db.query(AIConversation).filter(AIConversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # 1. Save user message
    user_message = AIMessage(
        conversation_id=conversation_id,
        role="user",
        content=request.content
    )
    db.add(user_message)
    db.commit()
    
    # 2. Build conversation history for context
    messages = db.query(AIMessage).filter(
        AIMessage.conversation_id == conversation_id
    ).order_by(AIMessage.created_at).all()
    
    # Limit to last 50 messages for context
    recent_messages = messages[-50:] if len(messages) > 50 else messages
    
    # 3. Call assistant with history context
    try:
        # Build history string for context
        history_context = "\n".join([
            f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
            for m in recent_messages[:-1]  # Exclude the message we just added
        ])
        
        # Prepend history to the question if there is any
        full_question = request.content
        if history_context:
            full_question = f"[Previous conversation context:\n{history_context}]\n\nUser's current question: {request.content}"
        
        result = await ask_assistant(
            question=full_question,
            bot=bot if bot and bot.is_active else None,
            auth_token=auth_token
        )
        
        assistant_response = result.get("answer", "I couldn't generate a response.")
        
        # Increment rate limit counter after successful response
        await check_rate_limit_via_edge(action="increment", tier=tier, auth_token=auth_token)
        
    except Exception as e:
        assistant_response = f"Sorry, I encountered an error: {str(e)}"
    
    # 4. Save assistant response
    assistant_message = AIMessage(
        conversation_id=conversation_id,
        role="assistant",
        content=assistant_response
    )
    db.add(assistant_message)
    
    # 5. Auto-generate title if this is the first exchange (2 messages: user + assistant)
    message_count = db.query(AIMessage).filter(
        AIMessage.conversation_id == conversation_id
    ).count()
    
    if message_count == 1 and conversation.title == "New Chat":
        # Set title to truncated first message (simple approach - no LLM call)
        first_msg = request.content[:40].strip()
        if len(request.content) > 40:
            first_msg = first_msg.rsplit(' ', 1)[0] + "..."  # Clean word boundary
        if first_msg:
            conversation.title = first_msg
    
    # Update conversation timestamp
    from datetime import datetime
    conversation.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "user_message": {
            "id": user_message.id,
            "role": "user",
            "content": request.content
        },
        "assistant_message": {
            "id": assistant_message.id,
            "role": "assistant",
            "content": assistant_response
        },
        "conversation_title": conversation.title
    }
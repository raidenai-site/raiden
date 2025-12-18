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

from worker.platforms.instagram import InstagramBot
from backend.models import get_db, Chat, ChatSettings
from backend.schemas import ChatSettingsUpdate, MessageSend, FullChatResponse, HistoryResponse
from backend.websockets import manager
from backend.user_profile import get_profile, generate_profile
from backend.reply_engine import generate_smart_reply

bot_instance: InstagramBot = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_instance
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
async def get_auth_status(bot: InstagramBot = Depends(get_bot)):
    """
    Frontend checks this to know what UI to show.
    - If has_session=True: Show Main App (Inbox).
    - If has_session=False: Show Login Screen.
    """
    return {
        "has_session": bot.has_session(),
        "is_active": bot.is_active  # True if the browser loop is running
    }

@app.post("/auth/login")
async def login_instagram(background_tasks: BackgroundTasks, bot: InstagramBot = Depends(get_bot)):
    """
    1. Opens Login Window.
    2. Waits for user to log in.
    3. Saves cookies & Closes Login Window.
    4. IMMEDIATELY starts the Listener (Browser).
    """
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
# 2. CHAT DATA
# =======================

@app.get("/instagram/chats", response_model=list[FullChatResponse])
async def get_chats(db: Session = Depends(get_db), bot: InstagramBot = Depends(get_bot)):
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
async def update_chat_settings(chat_id: str, updates: ChatSettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
    
    if not settings:
        chat_exists = db.query(Chat).filter(Chat.id == chat_id).first()
        if not chat_exists:
            new_chat = Chat(id=chat_id, username=chat_id)
            db.add(new_chat)
            db.commit()
        settings = ChatSettings(chat_id=chat_id)
        db.add(settings)
    
    for key, value in updates.dict(exclude_unset=True).items():
        setattr(settings, key, value)
    
    db.commit()
    
    if bot_instance and bot_instance.is_active:
        bot_instance.refresh_cache()
        
    return {"status": "updated", "chat_id": chat_id}

@app.post("/instagram/chat/{chat_id}/send")
async def send_message_endpoint(chat_id: str, message: MessageSend, bot: InstagramBot = Depends(get_bot)):
    success = await bot.send_message(chat_id, message.text)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to send.")
    return {"status": "sent", "text": message.text}

@app.post("/instagram/chat/{chat_id}/start")
async def start_conversation_endpoint(chat_id: str, db: Session = Depends(get_db), bot: InstagramBot = Depends(get_bot)):
    if not bot.is_active:
         raise HTTPException(503, "Bot offline.")

    # Send generating state
    await manager.broadcast(f"chat_{chat_id}", {
        "event": "log",
        "type": "generating",
        "text": "Generating conversation starter..."
    })

    print(f"🚀 Starting conversation with {chat_id}...")
    starter_msg = await generate_smart_reply(chat_id, bot, history_limit=5, is_starter=True)
    
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
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "sending",
            "text": f"Sending: {starter_msg}"
        })
        sent = await bot.send_message(chat_id, starter_msg)
        if not sent:
            raise HTTPException(500, "Failed to send message.")
        
        # Clear log after delay
        import asyncio
        await asyncio.sleep(2)
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "clear"
        })
        return {"status": "sent", "text": starter_msg}
    else:
        # Auto-reply OFF: show as suggestion
        await manager.broadcast(f"chat_{chat_id}", {
            "event": "log",
            "type": "suggestion",
            "text": starter_msg
        })
        return {"status": "suggested", "text": starter_msg}

@app.post("/instagram/chat/{chat_id}/regenerate")
async def regenerate_suggestion_endpoint(chat_id: str, bot: InstagramBot = Depends(get_bot)):
    """Regenerate AI suggestion for a chat"""
    if not bot.is_active:
        raise HTTPException(503, "Bot offline.")

    # Send generating state
    await manager.broadcast(f"chat_{chat_id}", {
        "event": "log",
        "type": "generating",
        "text": "Regenerating reply..."
    })

    reply = await generate_smart_reply(chat_id, bot)
    
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

@app.post("/instagram/chat/{chat_id}/profile/generate")
async def generate_chat_profile_endpoint(chat_id: str, bot: InstagramBot = Depends(get_bot)):
    if not bot.is_active:
         raise HTTPException(status_code=503, detail="Bot not active.")
         
    profile_data = await generate_profile(chat_id=chat_id, bot=bot, force_refresh=True)
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
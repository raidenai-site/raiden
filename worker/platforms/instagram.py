import asyncio
import sys
import os
import json
from pathlib import Path
from playwright.async_api import async_playwright
from datetime import datetime

# Path setup
backend_path = str(Path(__file__).parent.parent.parent / "backend")
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from .base import SocialPlatform
from backend.db import SessionManager
from backend.models import SessionLocal, Chat, ChatSettings, Message
from backend.websockets import manager 
from backend.reply_engine import generate_smart_reply
from backend.db2 import add_messages as db2_add_messages, init_db as db2_init
from backend.edge_client import check_rate_limit_via_edge, validate_membership_via_edge

class InstagramBot(SocialPlatform):
    def __init__(self):
        super().__init__()
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        # Store sessions in AppData (writable location)
        import os
        if os.name == 'nt':  # Windows
            appdata = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
        else:
            appdata = Path.home() / '.local' / 'share'
        data_dir = appdata / 'Raiden'
        data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = data_dir / "sessions.json"
        
        # State Flags
        self.is_active = False 
        self.cookies_ready = False  # True after cookie check completes (even if no cookies)
        self.tracked_cache = set()
        
        # Race condition prevention: track current chat and version
        self.current_chat_id = None
        self.history_version = 0
        
        # Track message IDs we've sent to WebSocket per chat (shared with HTTP endpoints)
        self.sent_message_ids: dict[str, set] = {}
        
        # Auth token for background AI calls (stored when user logs in)
        self._auth_token = None

    def set_auth_token(self, token: str):
        """Store auth token for background AI operations."""
        self._auth_token = token
        print(f"🔐 Auth token stored for background AI calls")
    
    def get_auth_token(self) -> str:
        """Get stored auth token for edge function calls."""
        if not self._auth_token:
            print("⚠️ [AUTH] No auth token stored! Background AI calls will fail.")
        return self._auth_token

    def has_session(self) -> bool:
        """Check if a valid session with cookies exists."""
        if not self.db_path.exists():
            return False
        
        try:
            import json
            with open(self.db_path, 'r') as f:
                data = json.load(f)
            
            # Check if instagram session exists and has cookies
            instagram_session = data.get("instagram", {})
            cookies = instagram_session.get("cookies", [])
            return isinstance(cookies, list) and len(cookies) > 0
        except (json.JSONDecodeError, IOError):
            return False

    def refresh_cache(self):
        print("🔄 Refreshing Tracked Chat Cache...")
        db = SessionLocal()
        try:
            settings = db.query(ChatSettings).filter(ChatSettings.enabled == True).all()
            self.tracked_cache = {s.chat_id for s in settings}
            print(f"✅ Cache Updated: {len(self.tracked_cache)} tracked chats.")
        except Exception as e:
            print(f"❌ Cache Update Failed: {e}")
        finally:
            db.close()

    def _get_global_settings(self) -> dict:
        """Read global settings from sessions.json"""
        if not self.db_path.exists():
            return {"auto_reply_all": False, "global_rules": ""}
        try:
            with open(self.db_path, 'r') as f:
                data = json.load(f)
            return data.get("global", {"auto_reply_all": False, "global_rules": ""})
        except (json.JSONDecodeError, IOError):
            return {"auto_reply_all": False, "global_rules": ""}

    def _apply_global_settings_to_chat(self, chat_id: str, global_rules: str) -> None:
        """Create ChatSettings for a new chat using global rules"""
        from backend.models import Chat
        db = SessionLocal()
        try:
            # Ensure Chat record exists
            chat = db.query(Chat).filter(Chat.id == chat_id).first()
            if not chat:
                chat = Chat(id=chat_id, username=chat_id)
                db.add(chat)
                db.commit()
            
            # Create or update settings
            settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
            if not settings:
                settings = ChatSettings(chat_id=chat_id)
                db.add(settings)
            
            settings.enabled = True
            settings.auto_reply = True
            settings.custom_rules = global_rules
            db.commit()
            
            # Update cache
            self.tracked_cache.add(chat_id)
            print(f"🌐 Applied global settings to new chat: {chat_id}")
        except Exception as e:
            print(f"❌ Failed to apply global settings: {e}")
        finally:
            db.close()

    async def _handle_reply_generation(self, chat_id: str):
        """Background task for generating and sending AI replies. Runs independently of main loop."""
        from backend.websockets import manager
        from backend.models import SessionLocal, ChatSettings
        from backend.edge_client import check_rate_limit_via_edge, validate_membership_via_edge
        from backend.reply_engine import generate_smart_reply
        
        try:
            print(f"🤔 [REPLY] Starting reply generation for {chat_id}...")
            
            # Check rate limit via edge function
            auth_token = self.get_auth_token()
            membership = await validate_membership_via_edge(auth_token) if auth_token else {"tier": "free"}
            user_tier = membership.get("tier", "free")
            
            rate_check = await check_rate_limit_via_edge(action="check", tier=user_tier, auth_token=auth_token)
            if not rate_check.get("allowed", True):
                reset_at = rate_check.get("reset_at", "unknown")
                print(f"⚠️ [REPLY] Rate limit reached for {chat_id}.")
                await manager.broadcast(f"chat_{chat_id}", {
                    "event": "log",
                    "type": "rate_limited",
                    "text": "Rate limit reached. Try again later."
                })
                await manager.broadcast("sidebar", {
                    "event": "rate_limited",
                    "chat_id": chat_id,
                    "reset_at": reset_at
                })
                return
            
            await manager.broadcast(f"chat_{chat_id}", {
                "event": "log",
                "type": "generating",
                "text": "Generating reply..."
            })
            
            print(f"🔄 [REPLY] Calling AI for {chat_id}...")
            reply = await generate_smart_reply(chat_id, self, auth_token=auth_token)
            print(f"🔄 [REPLY] Got reply: {reply[:50] if reply else 'None'}...")
            
            if reply:
                await check_rate_limit_via_edge(action="increment", tier=user_tier, auth_token=auth_token)
                
                db = SessionLocal()
                settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
                auto_send = settings.auto_reply if settings else False
                db.close()

                if auto_send:
                    # Split reply by newlines and send as separate messages
                    reply_parts = [line.strip() for line in reply.split('\n') if line.strip()]
                    
                    print(f"🚀 [REPLY] Auto-Sending: {len(reply_parts)} message(s)")
                    await manager.broadcast(f"chat_{chat_id}", {
                        "event": "log",
                        "type": "sending",
                        "text": f"Sending: {reply_parts[0]}{'...' if len(reply_parts) > 1 else ''}"
                    })
                    
                    for i, part in enumerate(reply_parts):
                        await self.send_message(chat_id, part)
                        if i < len(reply_parts) - 1:
                            await asyncio.sleep(0.8)
                    
                    await asyncio.sleep(1)
                    await manager.broadcast(f"chat_{chat_id}", {
                        "event": "log",
                        "type": "clear"
                    })
                else:
                    print(f"💡 [REPLY] Suggestion ready for {chat_id}")
                    await manager.broadcast(f"chat_{chat_id}", {
                        "event": "log",
                        "type": "clear"
                    })
                    await manager.broadcast("sidebar", {
                        "event": "suggestion",
                        "chat_id": chat_id,
                        "username": chat_id,
                        "text": reply
                    })
            else:
                await manager.broadcast(f"chat_{chat_id}", {
                    "event": "log",
                    "type": "clear"
                })
                
        except Exception as e:
            print(f"⚠️ [REPLY] Error generating reply for {chat_id}: {e}")
            await manager.broadcast(f"chat_{chat_id}", {
                "event": "log",
                "type": "clear"
            })

    async def _handle_popups(self):

        print("⏳ Waiting for page to stabilize...")
        try:
            await self.page.wait_for_load_state("networkidle", timeout=5000)
        except:
            pass

        print("🛡️ Starting Popup Defense (Clean Screen Protocol)...")

        # Broad list of everything we've seen in your logs
        popup_selectors = [
            'button:has-text("Not Now")',
            'div[role="dialog"] div[role="button"]:has-text("OK")',  # OK inside a dialog # Specific class combo
            'button:has-text("OK")',
            'button:has-text("Allow")',
            'button:has-text("Accept")',
            'button:has-text("Cancel")',
            'svg[aria-label="close"]',
            '[aria-label="close"]',
            'div[role="dialog"] button:has-text("Close")',
            'div[role="button"]:has-text("Not Now")'
        ]

        # Loop until the screen is clean
        max_attempts = 7  # Safety break (approx 15 seconds)
        for attempt in range(max_attempts):
            clicked_any_in_this_pass = False
            
            # CHECK EVERYTHING. DO NOT STOP.
            for selector in popup_selectors:
                try:
                    # Re-query every time to avoid stale elements
                    loc = self.page.locator(selector).first
                    
                    # If it exists and is visible, whack it.
                    if await loc.is_visible():
                        print(f"   💥 Found [{selector}] -> Clicking...")
                        try:
                            await loc.click(force=True, timeout=1000)
                            clicked_any_in_this_pass = True
                        except:
                            # If click fails (e.g., covered by another popup), just move to the next selector
                            print(f"   ⚠️ Click failed on [{selector}], trying next...")
                            pass
                except:
                    pass
            
            # Logic: If we clicked something, the DOM is changing. Wait a bit, then loop again.
            if clicked_any_in_this_pass:
                print("   🔄 Click registered. Waiting 1.5s for animations...")
                await asyncio.sleep(1.5)
            else:
                # If we scanned the WHOLE list and found NOTHING, we are done.
                print("✅ Scan complete. No popups visible.")
                break

        print("🛡️ Popup check finished.")

    async def login(self) -> bool:
        print("🔑 Starting Login Flow...")
        session_manager = SessionManager(str(self.db_path))
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=False, args=["--start-maximized"])
            context = await browser.new_context(no_viewport=True)
            page = await context.new_page()

            print("🌍 Navigating to Instagram...")
            try:
                await page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
            except Exception as e:
                print(f"❌ Navigation failed: {e}")
                await browser.close()
                return False

            print("⏳ Waiting for valid session... (Please log in manually)")
            
            for _ in range(300): 
                try:
                    if page.is_closed():
                        print("❌ Login window closed by user.")
                        return False
                    
                    cookies = await context.cookies()
                    if any(c["name"] == "sessionid" for c in cookies):
                        print("✅ Valid Session Detected!")
                        await asyncio.sleep(2)
                        final_cookies = await context.cookies()
                        session_manager.save_session("instagram", {"cookies": final_cookies})
                        print("💾 Session saved to disk.")
                        await browser.close()
                        return True
                    
                    await asyncio.sleep(1)
                except Exception as e:
                    print(f"⚠️ Polling error (browser closed?): {e}")
                    break
            
            print("❌ Login timed out or window closed.")
            if browser.is_connected():
                await browser.close()
            return False

    async def listen(self):
        if self.is_active:
            print("⚠️ Bot is already running.")
            return

        if not self.has_session():
            print("❌ No session found. Please /login first.")
            return

        print("🚀 Starting Bot Listener...")
        session_manager = SessionManager(str(self.db_path))
        session_data = session_manager.get_session("instagram")

        self.playwright = await async_playwright().start()
        
        # Check if running in headless mode
        is_headless = True  # Change to False for debugging
        
        self.browser = await self.playwright.chromium.launch(
            headless=is_headless, 
            args=["--start-maximized", "--force-device-scale-factor=0.44"] if not is_headless else []
        )
        
        # Headless mode: use deviceScaleFactor + large viewport to see more content
        # This simulates the zoom-out effect of --force-device-scale-factor=0.3
        if is_headless:
            self.context = await self.browser.new_context(
                viewport={"width": 7680, "height": 4320})
        else:
            self.context = await self.browser.new_context(no_viewport=True)

        if session_data and session_data.get("cookies"):
            print("🍪 Cookies loaded.")
            await self.context.add_cookies(session_data.get("cookies", []))
            self.cookies_ready = True  # Signal that cookie check is complete
        else:
            print("❌ Cookies missing from session file.")
            self.cookies_ready = True  # Signal that cookie check is complete (no cookies)
            await self.close()
            return

        self.page = await self.context.new_page()
        self.is_active = True 

        try:
            print("🌍 Opening Inbox...")
            await self.page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded")
            
            if "login" in self.page.url:
                print("❌ Cookies expired or invalid. Please /login again.")
                await self.close()
                return
            
            await self._handle_popups()
            self.refresh_cache()
            await self._listen_loop()

        except Exception as e:
            print(f"❌ Startup Error: {e}")
            await self.close()

    async def _listen_loop(self) -> None:
        print("🧠 Listener Loop Active.")
        
        change_event = asyncio.Event()
        await self.page.expose_binding("onSidebarChange", lambda source: change_event.set())
        
        script = """
        () => {
            const start = () => {
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.type === "attributes" || m.type === "characterData" || m.type === "childList") {
                            window.onSidebarChange();
                            break;
                        }
                    }
                });
                observer.observe(document.body, {
                    subtree: true,
                    attributes: true,
                    attributeFilter: ["aria-label"],
                    characterData: true,
                });
            };
            requestAnimationFrame(() => setTimeout(start, 500));
        }
        """
                # observer.observe(document.body, {
                #     subtree: true,
                #     childList: true,
                #     attributes: true,
                #     characterData: true,
                # });
        try: await self.page.evaluate(script)
        except: pass
    
        try:
            initial_data = await asyncio.wait_for(self.get_inbox(), timeout=4)
        except asyncio.TimeoutError:
            print("⚠️ [LOOP] Initial get_inbox timed out, aborting listen")
            return
        
        old_snapshot = {c["id"]: c["preview"] for c in initial_data}
        
        # --- INITIAL BROADCAST START ---
        print(f"📡 [WS] Broadcasting INITIAL sidebar state: {len(initial_data)} chats")
        initial_transformed = []
        from backend.models import SessionLocal, ChatSettings
        db = SessionLocal()
        try:
            for item in initial_data:
                chat_data = {
                    "id": item["id"],
                    "username": item["name"],
                    "full_name": item["name"],
                    "last_message": item["preview"],
                    "profile_pic": item.get("profile_pic", ""),
                    "is_tracked": item["id"] in self.tracked_cache
                }
                
                settings = db.query(ChatSettings).filter(ChatSettings.chat_id == item["id"]).first()
                if settings:
                    chat_data["settings"] = {
                        "enabled": settings.enabled,
                        "auto_reply": settings.auto_reply,
                        "custom_rules": settings.custom_rules
                    }
                else:
                    chat_data["settings"] = None
                
                initial_transformed.append(chat_data)
        finally:
            db.close()

        await manager.broadcast("sidebar", {
            "event": "sidebar_update",
            "chats": initial_transformed
        })
        # --- INITIAL BROADCAST END ---
        
        # Note: self.sent_message_ids is populated when user opens a chat via HTTP
        # This establishes baseline BEFORE listener detects changes


        while self.is_active:
            try:
                await asyncio.wait_for(change_event.wait(), timeout=3)
                print("sleeping for half second")
                await asyncio.sleep(.5)
                change_event.clear()
            except asyncio.TimeoutError:
                if not self.is_active: break
                continue

            try:
                # Dismiss any popups that may have appeared (light version - no load wait)
                popup_selectors = [
                    'button:has-text("Not Now")',
                    'div[role="dialog"] div[role="button"]:has-text("OK")',  # OK inside a dialog # Specific class combo
                    'button:has-text("OK")',
                    'button:has-text("Allow")',
                    'button:has-text("Accept")',
                    'button:has-text("Cancel")',
                    'svg[aria-label="close"]',
                    '[aria-label="close"]',
                    'div[role="dialog"] button:has-text("Close")',
                    'div[role="button"]:has-text("Not Now")'
                ]
                for selector in popup_selectors:
                    try:
                        loc = self.page.locator(selector).first
                        if await loc.is_visible(timeout=50):
                            await loc.click(force=True, timeout=500)
                            await asyncio.sleep(0.3)
                            break  # One popup at a time
                    except: pass

                try:
                    current_inbox = await asyncio.wait_for(self.get_inbox(), timeout=4)
                except asyncio.TimeoutError:
                    print("⚠️ [LOOP] get_inbox timed out, skipping...")
                    continue
                
                new_snapshot = {c["id"]: c["preview"] for c in current_inbox}

                if new_snapshot == old_snapshot: continue

                # DEBUG: Log sidebar change detection
                print(f"📊 [SIDEBAR] Change detected! Old keys: {len(old_snapshot)}, New keys: {len(new_snapshot)}")
          
                changed_chats = [cid for cid, prev in new_snapshot.items()
                                 if cid in old_snapshot and old_snapshot[cid] != prev
                                 and prev.lower() != "typing..."]  # Skip typing indicator
                
                transformed_chats = []
                for item in current_inbox:
                    chat_data = {
                        "id": item["id"],
                        "username": item["name"],
                        "full_name": item["name"],
                        "last_message": item["preview"],
                        "profile_pic": item.get("profile_pic", ""),
                        "is_tracked": item["id"] in self.tracked_cache
                    }
                    
                    # Include settings from database
                    from backend.models import SessionLocal, ChatSettings
                    db = SessionLocal()
                    try:
                        settings = db.query(ChatSettings).filter(ChatSettings.chat_id == item["id"]).first()
                        if settings:
                            chat_data["settings"] = {
                                "enabled": settings.enabled,
                                "auto_reply": settings.auto_reply,
                                "custom_rules": settings.custom_rules
                            }
                        else:
                            chat_data["settings"] = None
                    finally:
                        db.close()
                    
                    transformed_chats.append(chat_data)
                
                # DEBUG: Log sidebar broadcast
                tracked_count = sum(1 for c in transformed_chats if c.get('is_tracked'))
                print(f"📡 [WS] Broadcasting sidebar_update: {len(transformed_chats)} chats, {tracked_count} tracked")
                
                await manager.broadcast("sidebar", {
                    "event": "sidebar_update",
                    "chats": transformed_chats
                })

                old_snapshot = new_snapshot

                # DEBUG: Log changed chats
                if changed_chats:
                    print(f"💬 [SIDEBAR] Changed chats: {changed_chats}")
                else:
                    print(f"📊 [SIDEBAR] No message changes, only structural update")

                if not changed_chats: continue

                # Check global settings once per batch
                global_settings = self._get_global_settings()
                is_global_enabled = global_settings.get("auto_reply_all", False)

                for chat_id in changed_chats:
                    is_tracked = chat_id in self.tracked_cache
                    has_viewer = manager.is_active(chat_id)

                    # If global is enabled and chat is not tracked, apply global settings
                    if is_global_enabled and not is_tracked:
                        print(f"🌐 New chat detected with global AUTO enabled: {chat_id}")
                        self._apply_global_settings_to_chat(chat_id, global_settings.get("global_rules", ""))
                        is_tracked = True  # Now it's tracked

                    if not has_viewer and not is_tracked: continue

                    # Debounce: wait 3s for bundled messages to arrive
                    # Combined with version check, the last trigger wins
                    print(f"⏳ [LOOP] Debouncing 3s for {chat_id}...")
                    await asyncio.sleep(3)
                    
                    # NOTE: get_chat_history is now updated to handle GCs
                    print(f"🔄 [LOOP] Getting history for {chat_id}...")
                    history = await self.get_chat_history(chat_id=chat_id, limit=10)
                    print(f"🔄 [LOOP] History done for {chat_id}, {len(history) if history else 0} msgs")
                    if not history: continue
                    
                    # Initialize tracking set if not pre-loaded by HTTP endpoint
                    if chat_id not in self.sent_message_ids:
                        self.sent_message_ids[chat_id] = set()
                    
                    # Find NEW messages (not in our tracked set)
                    new_messages = []
                    current_ids = []
                    for msg in history:
                        msg_id = msg.get("message_id") if isinstance(msg, dict) else None
                        if msg_id:
                            current_ids.append(msg_id)
                            if msg_id not in self.sent_message_ids[chat_id]:
                                new_messages.append(msg)
                                self.sent_message_ids[chat_id].add(msg_id)
                        else:
                            # Message without ID - can't track it
                            text_preview = msg.get('text', '')[:30] if isinstance(msg, dict) else str(msg)[:30]
                            print(f"⚠️ [TRACK] Message WITHOUT ID: {text_preview}")
                    
                    print(f"📊 [TRACK] Current IDs: {current_ids[:3]}... | Tracked: {len(self.sent_message_ids[chat_id])} | New: {len(new_messages)}")
                    
                    if not new_messages:
                        print(f"📨 [WS] No new messages for {chat_id}")
                        continue
                    
                    print(f"📨 [WS] Found {len(new_messages)} new message(s) for {chat_id}")
                    
                    # Broadcast all new messages to viewers
                    if has_viewer:
                        for msg in new_messages:
                            msg_preview = msg.get('text', '')[:50] if isinstance(msg, dict) else str(msg)[:50]
                            print(f"📨 [WS] Broadcasting: {msg_preview}...")
                            await manager.broadcast(f"chat_{chat_id}", {"event": "new_message", "message": msg})
                    
                    # Use the LAST new message for reply generation
                    last_msg = new_messages[-1]

                    # Check if it's not from me (last_msg is now an object)
                    is_from_me = last_msg.get("is_me", False) if isinstance(last_msg, dict) else last_msg.startswith("Me:")
                    if is_tracked and not is_from_me:
                        print(f"🤔 Detected new message from {chat_id}. Spawning reply task...")
                        
                        # Spawn as background task so loop can continue without blocking
                        asyncio.create_task(self._handle_reply_generation(chat_id))

            except Exception as e:
                print(f"⚠️ Loop Error: {e}")
                if not self.is_active: break
        
        print("🛑 Listener Loop Ended.")

    async def get_inbox(self) -> list:
        if not self.page or self.page.is_closed(): return []
        print("📋 [INBOX] Starting get_inbox...")

        harvested = []
        try:
            print("📋 [INBOX] Getting all div[role=button] locators...")
            rows = await self.page.locator('div[role="button"]').all()
            print(f"📋 [INBOX] Found {len(rows)} button elements, iterating...")
            
            for i, row in enumerate(rows):
                try:
                    # Add short timeout (1s) to each element operation
                    bbox = await asyncio.wait_for(row.bounding_box(), timeout=1.0)
                    if not bbox: continue
                    # Filter by exact chat button dimensions: 397x72 at x=72
                    if not (bbox["width"] == 397 and bbox["height"] == 72 and bbox["x"] == 72): continue 

                    raw = await asyncio.wait_for(row.inner_text(), timeout=1.0)
                    lines = [l.strip() for l in raw.split("\n") if l.strip()]
                    if len(lines) < 2: continue

                    # Extract profile picture from the first image in the row
                    profile_pic = ""
                    try:
                        img_locator = row.locator('img').first
                        count = await asyncio.wait_for(img_locator.count(), timeout=1.0)
                        if count > 0:
                            profile_pic = await asyncio.wait_for(
                                img_locator.get_attribute('src'),
                                timeout=1.0
                            ) or ""
                    except asyncio.TimeoutError:
                        pass
                    except:
                        pass

                    # Skip entries without profile pic (garbage data)
                    if not profile_pic:
                        continue

                    harvested.append({
                        "id": lines[0],
                        "name": lines[0],
                        "preview": lines[1],
                        "last_message": lines[1],
                        "profile_pic": profile_pic
                    })
                except asyncio.TimeoutError:
                    # Skip this row if it times out, don't let it hang
                    continue
                except: 
                    continue
            print(f"📋 [INBOX] Done! Harvested {len(harvested)} chats")
            return harvested
        except asyncio.TimeoutError:
            print("📋 [INBOX] TIMEOUT getting button locators!")
            return []
        except Exception as e:
            print(f"📋 [INBOX] ERROR: {e}")
            return []

    async def get_chat_history(self, chat_id: str = None, limit: int = 500) -> list:
        if not self.page: return []
        
        # Race condition prevention: increment version and track current chat
        self.history_version += 1
        my_version = self.history_version
        self.current_chat_id = chat_id
        
        # Nav (unchanged)
        if chat_id:
            try:
                user_row = self.page.locator(f'div[role="button"]:has(span[title="{chat_id}"])').first
                if await user_row.count() == 0:
                     user_row = self.page.locator(f'div[role="button"]:has-text("{chat_id}")').first
                if await user_row.count() > 0: await user_row.click()
            except: return []

        # Wait Loading (unchanged)
        try:
            await self.page.evaluate("""
                async () => {
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                    for (let i = 0; i < 50; i++) {
                        const rows = document.querySelectorAll('div[role="row"]');
                        if (rows.length > 0 && !rows[0].innerText.includes("Loading")) return;
                        await sleep(100);
                    }
                }
            """)
            await asyncio.sleep(0.5)
        except: pass

        # Scrape - UPDATED WITH MEDIA SUPPORT + MESSAGE IDs
        try:
            messages = await self.page.evaluate(f"""
                () => {{
                    const rows = Array.from(document.querySelectorAll('div[role="row"]'));
                    const slicedRows = rows.slice(-{limit});
                    
                    const sendersFound = new Set();
                    let lastKnownSender = "Unknown";

                    const rawData = slicedRows.map((row, idx) => {{
                        const bubble = row.querySelector('div[dir="auto"]');
                        // Note: Some media messages might not have text bubbles, so we persist if bubble is null but media exists
                        
                        let text = "";
                        let isMe = false;
                        
                        // Extract message ID from the "Double tap to like" button
                        let messageId = null;
                        const likeBtn = row.querySelector('div[aria-label="Double tap to like"]');
                        if (likeBtn && likeBtn.id) {{
                            messageId = likeBtn.id.replace("double_tappable_id.", "");
                        }}
                        
                        // Instagram DM layout: sent messages align RIGHT, received align LEFT
                        // The chat container is typically centered, so we check relative to container center
                        
                        if (bubble) {{
                            // Clone bubble and replace emoji <img> tags with their alt text
                            const clone = bubble.cloneNode(true);
                            const emojiImgs = clone.querySelectorAll('img');
                            emojiImgs.forEach(img => {{
                                const alt = img.alt || '';
                                if (alt && alt.length <= 4) {{  // Emojis are 1-4 chars
                                    const textNode = document.createTextNode(alt);
                                    img.parentNode.replaceChild(textNode, img);
                                }}
                            }});
                            text = clone.innerText;
                            const rect = bubble.getBoundingClientRect();
                            isMe = rect.left + rect.width / 2 > window.innerWidth / 2;
                        }} else {{
                            // Fallback for media-only messages (reels, posts, photos, videos without text)
                            // Strategy: Find the main content element and check which side of the row it's on
                            
                            // Look for profile pictures - if there's a small circular avatar, message is FROM them (not me)
                            const avatarImg = row.querySelector('img[alt*="profile picture"]');
                            if (avatarImg) {{
                                const avatarRect = avatarImg.getBoundingClientRect();
                                // Avatar images are small (usually 28-40px) - if we find one, it's their message
                                if (avatarRect.width < 60 && avatarRect.height < 60) {{
                                    isMe = false;
                                }}
                            }} else {{
                                // No avatar visible - check content alignment
                                // Find the largest image (actual content, not icons)
                                const allImgs = Array.from(row.querySelectorAll('img'));
                                let contentImg = null;
                                let maxArea = 0;
                                
                                for (const img of allImgs) {{
                                    const w = img.clientWidth || 0;
                                    const h = img.clientHeight || 0;
                                    const area = w * h;
                                    if (area > maxArea && w > 50 && h > 50) {{
                                        maxArea = area;
                                        contentImg = img;
                                    }}
                                }}
                                
                                if (contentImg) {{
                                    const imgRect = contentImg.getBoundingClientRect();
                                    const rowRect = row.getBoundingClientRect();
                                    // Check if image center is in the right portion of the row
                                    const imgCenter = imgRect.left + imgRect.width / 2;
                                    const rowCenter = rowRect.left + rowRect.width / 2;
                                    isMe = imgCenter > rowCenter;
                                }}
                            }}
                        }}

                        let sender = null;

                        if (isMe) {{
                            sender = "Me";
                        }} else {{
                            // Attempt to find specific username
                            const link = row.querySelector('a[href*="/"]');
                            if (link) {{
                                const href = link.getAttribute('href');
                                const parts = href.split('/').filter(p => p.length > 0);
                                if (parts.length > 0) sender = parts[0];
                            }}

                            if (!sender) {{
                                const img = row.querySelector('img');
                                if (img && img.alt && !img.alt.includes("Seen by")) {{
                                    sender = img.alt.replace("profile picture", "").trim();
                                }}
                            }}
                            
                            // Memory fallback
                            if (sender) {{
                                lastKnownSender = sender;
                                sendersFound.add(sender);
                            }} else {{
                                sender = lastKnownSender;
                            }}
                        }}

                        // --- NEW MEDIA LOGIC START ---
                        let media = null;
                        const imgs = row.querySelectorAll('img');
                        for (const img of imgs) {{
                            // Use clientWidth (rendered size) for aspect ratio logic
                            const w = img.clientWidth || img.naturalWidth;
                            const h = img.clientHeight || img.naturalHeight;
                            const src = img.src;
                            const alt = img.alt || "";

                            // Filter small icons/avatars (> 50px)
                            if (w > 50 && h > 50 && src) {{
                                
                                // 1. Video
                                if (alt.includes("Open Video")) {{
                                    media = {{ type: "video", url: src, alt: alt }};
                                    break;
                                }} 
                                // 2. Photo
                                else if (alt.includes("Open photo")) {{
                                    media = {{ type: "photo", url: src, alt: alt }};
                                    break;
                                }} 
                                // 3. Reels vs Posts (Empty Alt Text)
                                else if (alt.trim() === "") {{
                                    const ratio = w / h;
                                    
                                    // Reel (Tall, ratio ~0.56)
                                    if (ratio < 0.65) {{
                                        media = {{ type: "reel", url: src, ratio: ratio }};
                                    }} 
                                    // Post (Square/4:5, ratio > 0.65)
                                    else {{
                                        media = {{ type: "post", url: src, ratio: ratio }};
                                    }}
                                    break;
                                }}
                            }}
                        }}
                        // --- NEW MEDIA LOGIC END ---

                        return {{ sender, text, isMe, media, messageId, sortScore: idx }};
                    }}).filter(msg => (msg.text || msg.media) && msg.messageId); // Keep if (text OR media) AND has ID

                    // 2. Diversity Check (GC Detection)
                    const uniqueSenders = Array.from(sendersFound).filter(s => s !== "Unknown");
                    const isGroupChat = uniqueSenders.length > 1;

                    // 3. Final Formatting
                    return rawData.map(msg => {{
                        let finalSender = msg.sender;
                        if (!msg.isMe && !isGroupChat) {{
                            finalSender = "Them";
                        }}
                        
                        // RETURN OBJECT (Required for Frontend Media + AI Assistant)
                        return {{
                            message_id: msg.messageId,
                            sender: finalSender,
                            text: msg.text,
                            is_me: msg.isMe,
                            media: msg.media,
                            sort_score: msg.sortScore
                        }};
                    }});
                }}
            """)
            
            print(f"📋 [DEBUG] JS scrape complete for {chat_id}, got {len(messages) if messages else 0} msgs")
            
            # Persist to db2 for AI assistant
            # Run in background thread to avoid blocking listener loop
            # But ONLY if we're still the current request (prevent race condition)
            if messages and chat_id:
                # Check if user switched chats while we were scraping
                if my_version != self.history_version:
                    print(f"⚠️ [DB2] Discarding stale results for '{chat_id}' (version {my_version} vs {self.history_version})")
                else:
                    try:
                        db2_messages = [
                            {
                                "message_id": m.get("message_id"),
                                "chat_id": chat_id,
                                "sender": m.get("sender", "Unknown"),
                                "text": m.get("text", ""),
                                "sort_score": m.get("sort_score", 0)
                            }
                            for m in messages
                            if m.get("message_id") and m.get("text")  # Only text messages for now
                        ]
                        if db2_messages:
                            print(f"📥 [DB2] Queueing {len(db2_messages)} messages for chat_id='{chat_id}'")
                            # Run in background thread to avoid blocking
                            import threading
                            def persist_async():
                                try:
                                    db2_add_messages(db2_messages, generate_embeddings=True)
                                except Exception as e:
                                    print(f"⚠️ db2 persistence failed: {e}")
                            threading.Thread(target=persist_async, daemon=True).start()
                    except Exception as e:
                        print(f"⚠️ db2 persistence failed: {e}")
            
            return messages
        except Exception as e: 
            print(f"History Scrape Error: {e}")
            return []

    async def get_chat_history_2(self, chat_id: str, scroll_depth: int = 15) -> list:
        """
        Deep chat history scraper with PageUp scrolling.
        Used by LLM as a tool for comprehensive message retrieval.
        
        Args:
            chat_id: Username/chat identifier
            scroll_depth: Number of PageUp scrolls (default: 15)
        
        Returns:
            Chronologically ordered list of messages (oldest first)
        """
        if not self.page: return []
        
        print(f"🔍 Deep scraping {chat_id} with {scroll_depth} scrolls...")
        
        # Navigate to chat
        try:
            user_row = self.page.locator(f'div[role="button"]:has(span[title="{chat_id}"])').first
            if await user_row.count() == 0:
                user_row = self.page.locator(f'div[role="button"]:has-text("{chat_id}")').first
            if await user_row.count() > 0: 
                await user_row.click()
                await asyncio.sleep(1)
        except Exception as e:
            print(f"❌ Could not navigate to chat: {e}")
            return []
        
        # Wait for chat to load
        try:
            await self.page.wait_for_selector('div[role="row"]', timeout=5000)
        except:
            print("❌ Chat did not load")
            return []
        
        # Focus chat area for keyboard input
        try:
            vp = self.page.viewport_size
            if vp:
                await self.page.mouse.click(vp['width'] * 0.7, vp['height'] * 0.5)
        except: pass
        
        # Collect messages across scroll iterations
        unique_messages = {}  # message_id -> message data
        
        for loop_num in range(scroll_depth):
            try:
                # Scrape current view
                current_msgs = await self.page.evaluate(f"""
                    () => {{
                        const rows = Array.from(document.querySelectorAll('div[role="row"]'));
                        const result = [];
                        
                        rows.forEach((row, idx) => {{
                            // Get message ID
                            const likeBtn = row.querySelector('div[aria-label="Double tap to like"]');
                            if (!likeBtn || !likeBtn.id) return;
                            const messageId = likeBtn.id.replace("double_tappable_id.", "");
                            
                            // Get text
                            const bubble = row.querySelector('div[dir="auto"]');
                            const text = bubble ? bubble.innerText : "";
                            if (!text) return;
                            
                            // Determine sender
                            let isMe = false;
                            if (bubble) {{
                                const rect = bubble.getBoundingClientRect();
                                isMe = rect.left + rect.width / 2 > window.innerWidth / 2;
                            }}
                            
                            let sender = isMe ? "Me" : "Them";
                            
                            // Try to get specific username for group chats
                            if (!isMe) {{
                                const img = row.querySelector('img');
                                if (img && img.alt && !img.alt.includes("Seen by")) {{
                                    const name = img.alt.replace("profile picture", "").trim();
                                    if (name) sender = name;
                                }}
                            }}
                            
                            result.push({{
                                messageId,
                                sender,
                                text,
                                isMe,
                                domIndex: idx
                            }});
                        }});
                        
                        return result;
                    }}
                """)
                
                # Add to unique collection with sort score
                # Formula: older loops get lower scores, newer get higher
                for msg in current_msgs:
                    if msg["messageId"] not in unique_messages:
                        # Loop 0 (newest) = high scores, Loop N (oldest) = low scores
                        sort_score = (loop_num * -1000) + msg["domIndex"]
                        unique_messages[msg["messageId"]] = {
                            "message_id": msg["messageId"],
                            "sender": msg["sender"],
                            "text": msg["text"],
                            "is_me": msg["isMe"],
                            "sort_score": sort_score
                        }
                
                print(f"   Loop {loop_num + 1}: Found {len(current_msgs)} messages, {len(unique_messages)} unique total")
                
                # Scroll up
                await self.page.keyboard.press("PageUp")
                await asyncio.sleep(1.5)
                
            except Exception as e:
                print(f"⚠️ Scroll loop {loop_num} error: {e}")
                continue
        
        # Sort by sort_score (ascending = oldest first)
        messages = list(unique_messages.values())
        messages.sort(key=lambda x: x["sort_score"])
        
        print(f"✅ Deep scrape complete: {len(messages)} unique messages")
        
        # Persist to db2
        if messages:
            try:
                db2_messages = [
                    {
                        "message_id": m["message_id"],
                        "chat_id": chat_id,
                        "sender": m["sender"],
                        "text": m["text"],
                        "sort_score": m["sort_score"]
                    }
                    for m in messages
                    if m.get("text")
                ]
                if db2_messages:
                    db2_add_messages(db2_messages, generate_embeddings=True)
            except Exception as e:
                print(f"⚠️ db2 persistence failed: {e}")
        
        return messages


    async def send_message(self, chat_id: str, text: str):
        if not self.is_active: return False
        try:
            print(f"📤 Sending to {chat_id}: {text}")
            await self.page.wait_for_selector('div[contenteditable="true"]', timeout=5000)
            box = self.page.locator('div[contenteditable="true"]').first
            await box.click()
            await box.fill(text)
            await self.page.keyboard.press("Enter")
            
            db = SessionLocal()
            db.add(Message(chat_id=chat_id, sender="me", message_text=text, timestamp=str(datetime.utcnow())))
            db.commit()
            db.close()
            return True
        except Exception as e:
            print(f"Send Error: {e}")
            return False

    async def close(self) -> None:
        print("🛑 Closing Bot...")
        self.is_active = False
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        self.browser = None
        self.playwright = None
        self.page = None

    async def logout(self):
        await self.close()
        if self.db_path.exists():
            os.remove(self.db_path)
            print("🗑️ Session file deleted.")

    async def sync_chats(self): pass
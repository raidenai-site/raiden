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

class InstagramBot(SocialPlatform):
    def __init__(self):
        super().__init__()
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        self.db_path = Path(__file__).parent.parent.parent / "backend" / "sessions.json"
        
        # State Flags
        self.is_active = False 
        self.tracked_cache = set()

    def has_session(self) -> bool:
        return self.db_path.exists()

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
            'div[role="button"]:has-text("OK")',
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
        max_attempts = 15  # Safety break (approx 15 seconds)
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
        self.browser = await self.playwright.chromium.launch(
            headless=False, 
            args=["--start-maximized", "--force-device-scale-factor=0.35"]
        )
        self.context = await self.browser.new_context(no_viewport=True)

        if session_data and session_data.get("cookies"):
            print("🍪 Cookies loaded.")
            await self.context.add_cookies(session_data.get("cookies", []))
        else:
            print("❌ Cookies missing from session file.")
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
                        if (m.type === "attributes" || m.type === "characterData") {
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
        try: await self.page.evaluate(script)
        except: pass

        initial_data = await self.get_inbox()
        old_snapshot = {c["id"]: c["preview"] for c in initial_data}

        while self.is_active:
            try:
                await asyncio.wait_for(change_event.wait(), timeout=1.0)
                change_event.clear()
            except asyncio.TimeoutError:
                if not self.is_active: break
                continue

            try:
                current_inbox = await self.get_inbox()
                new_snapshot = {c["id"]: c["preview"] for c in current_inbox}

                if new_snapshot == old_snapshot: continue
          
                changed_chats = [cid for cid, prev in new_snapshot.items()
                                 if cid in old_snapshot and old_snapshot[cid] != prev]
                
                transformed_chats = []
                for item in current_inbox:
                    transformed_chats.append({
                        "id": item["id"],
                        "username": item["name"],
                        "full_name": item["name"],
                        "last_message": item["preview"],
                        "profile_pic": item.get("profile_pic", ""),
                        "is_tracked": item["id"] in self.tracked_cache
                    })
                
                await manager.broadcast("sidebar", {
                    "event": "sidebar_update",
                    "chats": transformed_chats
                })

                old_snapshot = new_snapshot

                if not changed_chats: continue

                for chat_id in changed_chats:
                    is_tracked = chat_id in self.tracked_cache
                    has_viewer = manager.is_active(chat_id)

                    if not has_viewer and not is_tracked: continue

                    # NOTE: get_chat_history is now updated to handle GCs
                    history = await self.get_chat_history(chat_id=chat_id, limit=10)
                    if not history: continue
                    
                    last_msg = history[-1]
                    # Broadcast the full message object (sender, text, is_me, media)
                    await manager.broadcast(f"chat_{chat_id}", {"event": "new_message", "message": last_msg})

                    # Check if it's not from me (last_msg is now an object)
                    is_from_me = last_msg.get("is_me", False) if isinstance(last_msg, dict) else last_msg.startswith("Me:")
                    if is_tracked and not is_from_me:
                        print(f"🤔 Detected new message from {chat_id}. Thinking...")
                        
                        await manager.broadcast(f"chat_{chat_id}", {
                            "event": "log",
                            "type": "generating",
                            "text": "Generating reply..."
                        })
                        
                        reply = await generate_smart_reply(chat_id, self)
                        
                        if reply:
                            db = SessionLocal()
                            settings = db.query(ChatSettings).filter(ChatSettings.chat_id == chat_id).first()
                            auto_send = settings.auto_reply if settings else False
                            db.close()

                            if auto_send:
                                print(f"🚀 Auto-Sending: {reply}")
                                await manager.broadcast(f"chat_{chat_id}", {
                                    "event": "log",
                                    "type": "sending",
                                    "text": f"Sending: {reply}"
                                })
                                await self.send_message(chat_id, reply)
                                await asyncio.sleep(2)
                                await manager.broadcast(f"chat_{chat_id}", {
                                    "event": "log",
                                    "type": "clear"
                                })
                            else:
                                print(f"💡 Suggestion ready: {reply}")
                                await manager.broadcast(f"chat_{chat_id}", {
                                    "event": "log",
                                    "type": "suggestion",
                                    "text": reply
                                })
                        else:
                            await manager.broadcast(f"chat_{chat_id}", {
                                "event": "log",
                                "type": "clear"
                            })

            except Exception as e:
                print(f"⚠️ Loop Error: {e}")
                if not self.is_active: break
        
        print("🛑 Listener Loop Ended.")

    async def get_inbox(self) -> list:
        if not self.page or self.page.is_closed(): return []

        harvested = []
        try:
            rows = await self.page.locator('div[role="button"]').all()
            for row in rows:
                try:
                    bbox = await row.bounding_box()
                    if not bbox: continue
                    if not (bbox["width"] > 200 and bbox["height"] < 100): continue 

                    raw = await row.inner_text()
                    lines = [l.strip() for l in raw.split("\n") if l.strip()]
                    if len(lines) < 2: continue

                    # Extract profile picture from the first image in the row
                    profile_pic = ""
                    try:
                        img_locator = row.locator('img').first
                        if await img_locator.count() > 0:
                            profile_pic = await img_locator.get_attribute('src') or ""
                    except:
                        pass

                    harvested.append({
                        "id": lines[0],
                        "name": lines[0],
                        "preview": lines[1],
                        "last_message": lines[1],
                        "profile_pic": profile_pic
                    })
                except: continue
            return harvested
        except: return []

    async def get_chat_history(self, chat_id: str = None, limit: int = 500) -> list:
        if not self.page: return []
        
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

        # Scrape - UPDATED WITH MEDIA SUPPORT
        try:
            return await self.page.evaluate(f"""
                () => {{
                    const rows = Array.from(document.querySelectorAll('div[role="row"]'));
                    const slicedRows = rows.slice(-{limit});
                    
                    const sendersFound = new Set();
                    let lastKnownSender = "Unknown";

                    // 1. Extract Data
                    const rawData = slicedRows.map(row => {{
                        const bubble = row.querySelector('div[dir="auto"]');
                        // Note: Some media messages might not have text bubbles, so we persist if bubble is null but media exists
                        
                        let text = "";
                        let isMe = false;
                        
                        // Instagram DM layout: sent messages align RIGHT, received align LEFT
                        // The chat container is typically centered, so we check relative to container center
                        
                        if (bubble) {{
                            text = bubble.innerText;
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

                        return {{ sender, text, isMe, media }};
                    }}).filter(msg => msg.text || msg.media); // Keep if text OR media exists

                    // 2. Diversity Check (GC Detection)
                    const uniqueSenders = Array.from(sendersFound).filter(s => s !== "Unknown");
                    const isGroupChat = uniqueSenders.length > 1;

                    // 3. Final Formatting
                    return rawData.map(msg => {{
                        let finalSender = msg.sender;
                        
                        if (!msg.isMe && !isGroupChat) {{
                            finalSender = "Them";
                        }}
                        
                        // RETURN OBJECT (Required for Frontend Media)
                        return {{
                            sender: finalSender,
                            text: msg.text,
                            is_me: msg.isMe,
                            media: msg.media
                        }};
                    }});
                }}
            """)
        except Exception as e: 
            print(f"History Scrape Error: {e}")
            return []

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
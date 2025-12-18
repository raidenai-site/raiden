import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from .base import SocialPlatform

class WhatsAppBot(SocialPlatform):
    def __init__(self):
        super().__init__()
        self.qr_path = Path(__file__).parent.parent.parent / "backend" / "static" / "qr.png"
        self.qr_path.parent.mkdir(parents=True, exist_ok=True)
    
    async def login(self) -> bool:
        try:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(headless=False)
            self.context = await self.browser.new_context()
            self.page = await self.context.new_page()
            
            await self.page.goto("https://web.whatsapp.com", wait_until="networkidle")
            
            try:
                # Check if already logged in
                await self.page.wait_for_selector('[data-testid="chatlist-header"]', timeout=5000)
                return True
            except:
                # QR Logic
                try:
                    await self.page.wait_for_selector("canvas", timeout=30000)
                    await self.page.locator("canvas").screenshot(path=str(self.qr_path))
                    print(f"QR saved to {self.qr_path}")
                    await self.page.wait_for_selector('[data-testid="chatlist-header"]', timeout=60000)
                    return True
                except:
                    return False
        except Exception as e:
            print(f"Login Error: {e}")
            return False

    async def get_inbox(self) -> list:
        """Scrapes the sidebar for WhatsApp chats."""
        print("📑 Syncing WhatsApp Inbox...")
        try:
            # Wait for chat list
            await self.page.wait_for_selector('[data-testid="chat-list"]', timeout=10000)
            
            # Get the rows (WhatsApp usually uses role="row" or specific test-ids)
            # This selector finds the main div of each chat cell
            chat_rows = await self.page.locator('div[role="row"]').all()
            
            inbox_data = []
            for i, row in enumerate(chat_rows[:15]):
                try:
                    text_content = await row.inner_text()
                    lines = text_content.split('\n')
                    
                    # WhatsApp structure varies, but usually Name is top, Msg is bottom
                    name = lines[0] if len(lines) > 0 else "Unknown"
                    preview = lines[1] if len(lines) > 1 else ""
                    
                    # Check for Green Badge
                    is_unread = await row.locator('span[aria-label*="unread"]').count() > 0
                    
                    inbox_data.append({
                        "id": f"wa_{i}",
                        "name": name,
                        "last_message": preview,
                        "unread": is_unread
                    })
                except:
                    continue
            
            return inbox_data
        except Exception as e:
            print(f"Error syncing inbox: {e}")
            return []

    async def listen(self) -> None:
        print("🎧 Listening for WhatsApp messages...")
        while True:
            await asyncio.sleep(2)

    async def close(self) -> None:
        if self.browser: await self.browser.close()
        if self.playwright: await self.playwright.stop()
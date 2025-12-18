import asyncio
import json
import os
from playwright.async_api import async_playwright

# CONFIG
COOKIES_FILE = 'backend/sessions.json' 
URL = "https://www.instagram.com/direct/inbox/"

async def load_cookies(context, path):
    if os.path.exists(path):
        with open(path, 'r') as f:
            data = json.load(f)
            if isinstance(data, dict):
                cookies = data.get("cookies", [data])
            elif isinstance(data, list):
                cookies = data
            else:
                return
            try:
                await context.add_cookies(cookies)
                print(f"Loaded {len(cookies)} cookies.")
            except: pass

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        await load_cookies(context, COOKIES_FILE)
        
        page = await context.new_page()
        print(f"Navigating to {URL}...")
        await page.goto(URL)
        
        print("\n" + "="*40)
        print("WAITING FOR YOU.")
        print("1. Scroll the sidebar to load users.")
        input("2. Press ENTER to harvest profile pics >")
        print("="*40 + "\n")

        harvested = []
        print("Scanning rows with your BBox filter (Width > 200, Height < 100)...")

        # --- YOUR LOGIC HERE ---
        rows = await page.locator('div[role="button"]').all()
        
        for row in rows:
            try:
                # 1. Apply the Container Filter
                bbox = await row.bounding_box()
                if not bbox: continue
                
                # The Golden Rule you provided:
                if not (bbox["width"] > 200 and bbox["height"] < 100): 
                    continue
                
                # 2. Extract Data from Valid Row
                text = await row.inner_text()
                lines = text.split('\n')
                username = lines[0] if lines else "Unknown"
                
                # Get the first image in this valid row
                img_locator = row.locator('img').first
                if await img_locator.count() > 0:
                    pic_url = await img_locator.get_attribute('src')
                    
                    harvested.append({
                        "username": username,
                        "pic_url": pic_url
                    })
                    print(f"[MATCH] {username}")

            except Exception as e:
                # print(f"Error on row: {e}")
                pass
        
        print("-" * 40)
        print(f"Total Unique Chats Found: {len(harvested)}")
        
        # Clean Output
        for chat in harvested:
            print(f"User: {chat['username']}")
            print(f"Pic:  {chat['pic_url'][:50]}...")
            print("")

        print("Done. Press ENTER to close.")
        input()
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
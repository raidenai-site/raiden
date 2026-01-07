"""
Debug script to compare emoji scraping techniques.
Loads Playwright with your cookies and tests both methods.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

SESSIONS_FILE = Path(__file__).parent / "backend" / "sessions.json"

async def main():
    print("🔍 Debug Emoji Scraping")
    print("=" * 50)
    
    # Load cookies
    if not SESSIONS_FILE.exists():
        print("❌ No sessions.json found! Run the app first to login.")
        return
    
    with open(SESSIONS_FILE, "r") as f:
        sessions = json.load(f)
    
    cookies = sessions.get("instagram", {}).get("cookies", [])
    if not cookies:
        print("❌ No Instagram cookies found!")
        return
    
    print(f"✅ Loaded {len(cookies)} cookies")
    
    # Launch browser
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless=False,
        args=["--start-maximized"]
    )
    context = await browser.new_context(no_viewport=True)
    await context.add_cookies(cookies)
    
    page = await context.new_page()
    
    print("� Opening Instagram DMs...")
    await page.goto("https://www.instagram.com/direct/inbox/", wait_until="domcontentloaded")
    await asyncio.sleep(3)
    
    print("\n" + "=" * 50)
    print("📌 NOW: Click on a chat that has emojis in its messages")
    print("=" * 50)
    input("\n>>> Press ENTER when you're in the chat...")
    
    await asyncio.sleep(1)
    
    # ====================
    # METHOD 1: Current (innerText)
    # ====================
    print("\n🔬 METHOD 1: innerText (Current)")
    print("-" * 40)
    
    method1_results = await page.evaluate("""
        () => {
            const rows = Array.from(document.querySelectorAll('div[role="row"]'));
            return rows.slice(-10).map((row, idx) => {
                const bubble = row.querySelector('div[dir="auto"]');
                return {
                    index: idx,
                    text: bubble ? bubble.innerText : "(no bubble)",
                    hasContent: !!bubble
                };
            });
        }
    """)
    
    for msg in method1_results:
        print(f"  [{msg['index']}] {msg['text'][:80] if msg['text'] else '(empty)'}...")
    
    # ====================
    # METHOD 2: textContent (Alternative)
    # ====================
    print("\n🔬 METHOD 2: textContent (Alternative)")
    print("-" * 40)
    
    method2_results = await page.evaluate("""
        () => {
            const rows = Array.from(document.querySelectorAll('div[role="row"]'));
            return rows.slice(-10).map((row, idx) => {
                const bubble = row.querySelector('div[dir="auto"]');
                return {
                    index: idx,
                    text: bubble ? bubble.textContent : "(no bubble)",
                    hasContent: !!bubble
                };
            });
        }
    """)
    
    for msg in method2_results:
        print(f"  [{msg['index']}] {msg['text'][:80] if msg['text'] else '(empty)'}...")
    
    # ====================
    # METHOD 3: innerHTML to see raw structure
    # ====================
    print("\n🔬 METHOD 3: innerHTML (See structure)")
    print("-" * 40)
    
    method3_results = await page.evaluate("""
        () => {
            const rows = Array.from(document.querySelectorAll('div[role="row"]'));
            return rows.slice(-5).map((row, idx) => {
                const bubble = row.querySelector('div[dir="auto"]');
                return {
                    index: idx,
                    html: bubble ? bubble.innerHTML.substring(0, 300) : "(no bubble)",
                };
            });
        }
    """)
    
    for msg in method3_results:
        print(f"  [{msg['index']}] {msg['html']}...")
    
    # ====================
    # METHOD 4: Playwright's inner_text() (like sidebar uses)
    # ====================
    print("\n🔬 METHOD 4: Playwright inner_text() (like sidebar)")
    print("-" * 40)
    
    rows = await page.locator('div[role="row"]').all()
    for i, row in enumerate(rows[-10:]):
        try:
            text = await row.inner_text()
            print(f"  [{i}] {text[:80] if text else '(empty)'}...")
        except:
            print(f"  [{i}] (error)")
    
    # ====================
    # METHOD 5: Extract emoji img alt text
    # ====================
    print("\n🔬 METHOD 5: innerText + emoji img alt")
    print("-" * 40)
    
    method5_results = await page.evaluate("""
        () => {
            const rows = Array.from(document.querySelectorAll('div[role="row"]'));
            return rows.slice(-10).map((row, idx) => {
                const bubble = row.querySelector('div[dir="auto"]');
                if (!bubble) return { index: idx, text: "(no bubble)" };
                
                // Clone the node so we don't modify the DOM
                const clone = bubble.cloneNode(true);
                
                // Replace all emoji images with their alt text
                const emojiImgs = clone.querySelectorAll('img');
                emojiImgs.forEach(img => {
                    const alt = img.alt || '';
                    if (alt && alt.length <= 4) {  // Emojis are usually 1-2 chars
                        const textNode = document.createTextNode(alt);
                        img.parentNode.replaceChild(textNode, img);
                    }
                });
                
                return {
                    index: idx,
                    text: clone.innerText
                };
            });
        }
    """)
    
    for msg in method5_results:
        print(f"  [{msg['index']}] {msg['text'][:80] if msg['text'] else '(empty)'}...")
    
    print("\n" + "=" * 50)
    print("✅ Done! Compare the methods above to see which has emojis.")
    print("=" * 50)
    
    input("\n>>> Press ENTER to close browser...")
    await browser.close()
    await playwright.stop()

if __name__ == "__main__":
    asyncio.run(main())

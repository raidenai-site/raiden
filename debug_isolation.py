import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

# ---- CONFIG ----
INSTAGRAM_INBOX = "https://www.instagram.com/direct/inbox/"
COOKIE_PATH = Path(__file__).parent / "backend/sessions.json"  # adjust if needed
# ----------------


async def load_cookies(context):
    import json
    if not COOKIE_PATH.exists():
        print("❌ No cookies file found")
        return

    data = json.loads(COOKIE_PATH.read_text())
    cookies = data.get("instagram", {}).get("cookies", [])
    if cookies:
        await context.add_cookies(cookies)
        print("🍪 Cookies loaded")


async def method_a_python_dom(page, limit=200):
    # """
    # Method A:
    # Playwright locator-based DOM access (still JS underneath, but Python API)
    # """
    # messages = []

    # rows = page.locator('div[role="row"]')
    # count = await rows.count()

    # for i in range(max(0, count - limit), count):
    #     row = rows.nth(i)
    #     bubble = row.locator('div[dir="auto"]')
    #     if await bubble.count() == 0:
    #         continue

    #     text = (await bubble.inner_text()).strip()
    #     if not text:
    #         continue

    #     messages.append(text)

    # return messages
    return await page.evaluate(f"""
        () => {{
            const rows = Array.from(document.querySelectorAll('div[role="row"]'));
            return rows.slice(-{limit}).map(row => {{
                const bubble = row.querySelector('div[dir="auto"]');
                if (!bubble) return null;

                const rect = bubble.getBoundingClientRect();
                const role = rect.left + rect.width / 2 > window.innerWidth / 2
                    ? "Me"
                    : "Them";

                let text = bubble.innerText;                   
                return role + ": " + text;
            }}).filter(Boolean);
        }}
    """)

async def method_b_js_eval(page, limit=200):
    """
    Method B:
    Your current JS evaluate approach
    """
    return await page.evaluate(f"""
        () => {{
            const rows = Array.from(document.querySelectorAll('div[role="row"]'));
            return rows.slice(-{limit}).map(row => {{
                const bubble = row.querySelector('div[dir="auto"]');
                return bubble ? bubble.innerText.trim() : null;
            }}).filter(Boolean);
        }}
    """)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=["--start-maximized","--force-device-scale-factor=0.75"]
        )
        context = await browser.new_context(no_viewport=True)

        await load_cookies(context)

        page = await context.new_page()
        print("🌍 Opening Instagram inbox…")
        await page.goto(INSTAGRAM_INBOX, wait_until="domcontentloaded")

        if "login" in page.url:
            print("❌ Logged out. Login manually, then restart.")
            return

        print("\n✅ Ready.")
        print("👉 Open ANY chat manually.")
        input("⏸️ Press ENTER once the chat is open...")
# --- PASTE THIS DEBUG BLOCK ---
# ---------------- DEBUGGING START ----------------
        print("\n🕵️‍♂️ --- DEEP FORENSICS: DEBUG SCRIPT ---")
        debug_info = await page.evaluate("""() => {
            const allRows = Array.from(document.querySelectorAll('div[role="row"]'));
            const mainRows = Array.from(document.querySelectorAll('[role="main"] div[role="row"]'));
            
            // Try to find the scroll container used by Instagram
            const mainDiv = document.querySelector('[role="main"]');
            const scroller = mainDiv ? mainDiv.querySelector('div[style*="overflow"]') : null;

            return {
                "Viewport": `${window.innerWidth}x${window.innerHeight}`,
                "DeviceScale": window.devicePixelRatio,
                "Total Rows (Global)": allRows.length,
                "Chat Rows (In [role=main])": mainRows.length,
                "Scroll Position": scroller ? Math.round(scroller.scrollTop) : "N/A",
                "Scroll Height": scroller ? scroller.scrollHeight : "N/A",
                "First 3 Rows": mainRows.slice(0, 3).map(r => ({
                    text: r.innerText.split('\\n')[0].substring(0, 15),
                    height: r.offsetHeight,
                    top_y: Math.round(r.getBoundingClientRect().top)
                })),
                "Last 3 Rows": mainRows.slice(-3).map(r => ({
                    text: r.innerText.split('\\n')[0].substring(0, 15),
                    height: r.offsetHeight,
                    top_y: Math.round(r.getBoundingClientRect().top)
                }))
            }
        }""")
        import json
        print(json.dumps(debug_info, indent=2))
        print("-------------------------------------------\n")
        a = await method_a_python_dom(page)
        b = await method_b_js_eval(page)
        print(b[:3])
        print(a[:3])

        input("\nPress ENTER to close browser.")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

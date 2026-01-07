"""
Instagram Sidebar Analyzer
Shows chat names and their exact dimensions in the sidebar.
"""
import time
from playwright.sync_api import sync_playwright
import json
import os

def _handle_popups(page):

    print("⏳ Waiting for page to stabilize...")
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
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
                loc = page.locator(selector).first
                
                # If it exists and is visible, whack it.
                if loc.is_visible():
                    print(f"   💥 Found [{selector}] -> Clicking...")
                    try:
                        loc.click(force=True, timeout=1000)
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
            time.sleep(1.5)
        else:
            # If we scanned the WHOLE list and found NOTHING, we are done.
            print("✅ Scan complete. No popups visible.")
            break

    print("🛡️ Popup check finished.")

# Path to saved session
SESSIONS_PATH = os.path.join(os.path.dirname(__file__), "backend", "sessions.json")

def load_cookies():
    """Load saved Instagram cookies from sessions.json"""
    try:
        with open(SESSIONS_PATH, "r") as f:
            data = json.load(f)
            instagram_data = data.get("instagram", {})
            return instagram_data.get("cookies", [])
    except Exception as e:
        print(f"❌ Failed to load cookies: {e}")
        return []

def analyze_buttons():
    with sync_playwright() as p:
        is_headless = False  # Change to False for debugging
        
        browser = p.chromium.launch(
            headless=is_headless, 
            args=["--start-maximized"] 
        )
        
        # Headless mode: use deviceScaleFactor + large viewport to see more content
        # This simulates the zoom-out effect of --force-device-scale-factor=0.3
        context = browser.new_context(
            viewport={"width": 7680, "height": 4320})

        
        # Load saved cookies
        cookies = load_cookies()
        if cookies:
            print(f"🍪 Loading {len(cookies)} saved cookies...")
            context.add_cookies(cookies)
        else:
            print("⚠️ No saved cookies found. You'll need to log in manually.")
        
        page = context.new_page()
        page.goto("https://www.instagram.com/direct/inbox/")

        _handle_popups(page)
        
        print("\n" + "="*60)
        print("INSTRUCTIONS:")
        print("1. Wait for page to load completely")
        print("2. Make sure you can see the chat sidebar")
        print("3. Press Enter to analyze chat dimensions")
        print("="*60)
        input("\n>>> Press Enter when ready to analyze...")
        
        # Get all button elements
        buttons = page.locator('div[role="button"]').all()
        print(f"\n📊 Found {len(buttons)} div[role='button'] elements\n")
        
        print(f"{'='*70}")
        print(f"{'#':<4} {'NAME':<25} {'WIDTH':<8} {'HEIGHT':<8} {'X':<8} {'Y':<8}")
        print(f"{'='*70}")
        
        for i, btn in enumerate(buttons):
            try:
                # Get bounding box (dimensions and position)
                bbox = btn.bounding_box()
                
                # Get inner text for name
                inner_text = btn.inner_text()
                lines = [l.strip() for l in inner_text.split("\n") if l.strip()]
                name = lines[0][:24] if lines else "(no text)"
                
                if (bbox["width"] == 397 and bbox["height"] == 72 and bbox["x"] == 72):
                    print(f"{i:<4} {name:<25} {bbox['width']:<8.0f} {bbox['height']:<8.0f} {bbox['x']:<8.0f} {bbox['y']:<8.0f}")
                
            except Exception as e:
                print(f"{i:<4} {'(error)':<25} {str(e)[:40]}")
                continue
        
        print(f"{'='*70}")
        
        input("\n>>> Press Enter to close browser...")
        browser.close()

if __name__ == "__main__":
    analyze_buttons()
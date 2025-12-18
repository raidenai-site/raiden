import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

SESSION_PATH = Path("backend/sessions.json")

async def analyze_chat_structure(page):
    print("\n🕵️  Analyzing chat DOM...")

    report = await page.evaluate("""() => {
        const rows = Array.from(document.querySelectorAll('div[role="row"]'));
        
        // --- STEP 1: COLLECT ALL SENDERS ---
        // We scan every 'Them' message to find their username handle.
        
        const sendersFound = new Set();
        const results = [];
        let lastKnownSender = "Unknown";

        rows.forEach((row, index) => {
            const bubble = row.querySelector('div[dir="auto"]');
            if (!bubble) return;
            
            const text = bubble.innerText;
            const rect = bubble.getBoundingClientRect();
            const isMe = rect.left + rect.width / 2 > window.innerWidth / 2;
            
            let sender = null;

            if (isMe) {
                sender = "Me";
            } else {
                // Try to find the specific username for this row
                
                // Strategy A: Link Href (Best)
                const link = row.querySelector('a[href*="/"]');
                if (link) {
                    const href = link.getAttribute('href');
                    const parts = href.split('/').filter(p => p.length > 0);
                    if (parts.length > 0) sender = parts[0];
                }
                
                // Strategy B: Image Alt
                if (!sender) {
                    const img = row.querySelector('img');
                    if (img && img.alt) sender = img.alt.replace("profile picture", "").trim();
                }

                // Strategy C: Memory (for consecutive messages)
                if (sender) {
                    lastKnownSender = sender;
                    sendersFound.add(sender); // Add to our diversity set
                } else {
                    sender = lastKnownSender;
                }
            }

            results.push({
                role: sender, // We store the specific name for now
                text: text.substring(0, 50).replace(/\\n/g, " "),
                is_me: isMe
            });
        });

        // --- STEP 2: DECIDE MODE ---
        // If we found 2 or more UNIQUE senders on the left side, it is a Group Chat.
        // If we found 0 or 1 unique sender, it is a DM.
        
        const uniqueSenders = Array.from(sendersFound).filter(s => s !== "Unknown");
        const isGroupChat = uniqueSenders.length > 1;

        // --- STEP 3: FORMAT OUTPUT ---
        // If it's a DM, we rename the specific user to "Them" to match your preference.
        
        const finalMessages = results.map(msg => {
            if (msg.is_me) return msg;
            
            if (isGroupChat) {
                return msg; // Keep specific name (e.g. "sanvin_sam")
            } else {
                msg.role = "Them"; // Override to "Them"
                return msg;
            }
        });

        return {
            mode: isGroupChat ? "GROUP CHAT" : "DM",
            reason: `Found ${uniqueSenders.length} unique senders: [${uniqueSenders.join(", ")}]`,
            messages: finalMessages
        };
    }""")

    return report

async def main():
    if not SESSION_PATH.exists():
        print(f"❌ Could not find session file at {SESSION_PATH}")
        return

    print("🍪 Loading cookies...")
    with open(SESSION_PATH, "r") as f:
        session_data = json.load(f)
        cookies = session_data.get("instagram", {}).get("cookies", [])

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        if cookies: await context.add_cookies(cookies)
        page = await context.new_page()
        
        print("🌍 Navigating to Inbox...")
        await page.goto("https://www.instagram.com/direct/inbox/")

        while True:
            print("\n" + "="*60)
            print("🚨 READY TO TEST 🚨")
            print("1. Click a chat (Try a DM first, then a GC).")
            print("2. Press ENTER to analyze.")
            print("3. Type 'exit' to quit.")
            print("="*60)
            
            cmd = input("Command: ").strip()
            if cmd.lower() == "exit": break

            try:
                data = await analyze_chat_structure(page)
                
                print(f"\n🧪 DETECTION RESULT: {data['mode']}")
                print(f"🔎 Reason: {data['reason']}")
                print("-" * 40)
                
                msgs = data['messages'][-10:] if len(data['messages']) > 10 else data['messages']
                
                for m in msgs:
                    if m['role'] == "Me":
                        print(f"🟢 Me:   {m['text']}")
                    else:
                        print(f"🔴 {m['role']}: {m['text']}")
                print("-" * 40)
            except Exception as e:
                print(f"❌ Error during analysis: {e}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
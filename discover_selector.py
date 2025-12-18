import asyncio
import sys
import json
import os
from pathlib import Path

# ---------------------------------------------------------
# 1. SETUP PYTHON PATH
# Allows imports from 'backend' and 'worker' folders
# ---------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent))

from worker.platforms.instagram import InstagramBot
# Note: updating import to match your new path 'backend.llm.user_profile'
from backend.user_profile import generate_profile, get_profile

async def main():
    print("🤖 --- RAIDEN PROFILE GENERATOR TEST ---")
    
    # 2. CHECK API KEY
    if not os.getenv("GEMINI_API_KEY"):
        print("❌ Error: GEMINI_API_KEY is not set in your environment variables.")
        return

    # 3. INITIALIZE BOT
    print("🔌 Initializing Instagram Bot...")
    bot = InstagramBot()
    
    # Login using existing session file
    success = await bot.login()
    if not success:
        print("❌ Login failed. Please check 'backend/sessions.json' or login via main app first.")
        await bot.close()
        return

    print("✅ Login successful.\n")

    # 4. GET TARGET USER
    target_username = input("🎯 Enter the Instagram username (chat_id) to analyze: ").strip()
    if not target_username:
        print("❌ No username provided.")
        await bot.close()
        return

    # 5. EXECUTE GENERATION
    print(f"\n🧠 Generating profile for '{target_username}'...")
    print("   (This will scrape history -> call Gemini -> save to DB)")
    
    # We pass the bot instance so the function can scrape fresh data
    profile_data = await generate_profile(chat_id=target_username, bot=bot, message_limit=200, force_refresh=True)

    # 6. REPORT RESULTS
    if profile_data:
        print("\n✨ GENERATION SUCCESS!")
        print("-" * 40)
        print(json.dumps(profile_data, indent=2))
        print("-" * 40)
        
        # 7. VERIFY DB PERSISTENCE
        print("\n🔍 Verifying database storage...")
        saved_profile = get_profile(target_username)
        
        if saved_profile == profile_data:
            print("✅ DB VERIFIED: Stored profile matches generated output.")
        else:
            print("⚠️ DB MISMATCH: Retrieved data differs from generation.")
            print("Stored:", saved_profile)
    else:
        print("\n❌ Generation failed (check logs above for errors).")

    # 8. CLEANUP
    print("\n👋 Closing browser...")
    await bot.close()

if __name__ == "__main__":
    # Windows-specific event loop policy fix
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    asyncio.run(main())
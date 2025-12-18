import asyncio
import sys
from pathlib import Path
import time

sys.path.insert(0, str(Path(__file__).parent))

from worker.platforms.instagram import InstagramBot
from backend.reply_engine import generate_smart_reply

async def main():
    print("🤖 --- RAIDEN REPLY ENGINE TEST ---")
    
    bot = InstagramBot()
    if not await bot.login():
        print("❌ Login failed")
        return

    target = input("🎯 Enter chat_id to test reply on: ").strip()
    
    print(f"\n🧠 Thinking of a reply for {target}...")
    reply = await generate_smart_reply(target, bot)
    
    if reply:
        print(f"\n✨ SUGGESTED REPLY:\n'{reply}'")
        
        confirm = input("\n📤 Send this message? (y/n): ")
        if confirm.lower() == 'y':
            await bot.send_message(target, reply)
            await asyncio.sleep(2)
            print("✅ Sent!")

    else:
        print("❌ Failed to generate reply (Check if profile exists first!)")

    await bot.close()

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())
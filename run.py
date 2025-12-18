import asyncio
import sys
import uvicorn
import os

# 1. Force Windows to use the correct Proactor Loop
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

if __name__ == "__main__":
    print("🚀 Starting Raiden Server...")
    print("💡 Press Ctrl+C to stop.")

    try:
        # reload=False is REQUIRED for this fix to work effectively
        uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
        
    except KeyboardInterrupt:
        pass
        
    finally:
        print("\n👋 Force quitting process to kill Playwright zombies...")
        # This is the line that fixes your issue:
        os._exit(0)
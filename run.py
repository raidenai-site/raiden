import asyncio
import sys
import uvicorn
import os
import subprocess
from pathlib import Path
import io

# PyInstaller frozen mode detection
IS_FROZEN = getattr(sys, 'frozen', False)
if IS_FROZEN:
    # When bundled, set the base path to the exe directory
    BASE_DIR = Path(sys.executable).parent
    os.chdir(BASE_DIR)
    # Add the backend directory to Python path
    sys.path.insert(0, str(BASE_DIR))
    
    # Fix console encoding for Windows - emojis cause issues with cp1252
    # Wrap stdout/stderr with UTF-8 encoding and error handling
    if sys.platform == "win32":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    
    # Set Playwright browsers path to bundled location
    # The browsers are bundled in _internal/playwright-browsers/
    playwright_browsers_path = BASE_DIR / '_internal' / 'playwright-browsers'
    os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(playwright_browsers_path)
else:
    BASE_DIR = Path(__file__).parent

def kill_playwright_chromium():
    """Kill only Playwright's chromium (in ms-playwright folder), not regular Chrome"""
    if sys.platform == "win32":
        try:
            # Get all chromium processes
            result = subprocess.run(
                ["wmic", "process", "where", "name='chromium.exe'", "get", "processid,executablepath"],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            for line in result.stdout.split('\n'):
                if 'ms-playwright' in line.lower() or 'playwright' in line.lower():
                    # Extract PID and kill it
                    parts = line.strip().split()
                    for part in parts:
                        if part.isdigit():
                            subprocess.run(["taskkill", "/F", "/PID", part], capture_output=True)
        except:
            pass  # Ignore errors

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
        print("\n👋 Shutting down gracefully...")
        kill_playwright_chromium()
        
    except Exception as e:
        print(f"❌ Server error: {e}")
        kill_playwright_chromium()
        sys.exit(1)
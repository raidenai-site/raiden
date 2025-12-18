import json
import os
from typing import Optional, Dict, Any

# Define absolute path to sessions.json
SESSION_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "sessions.json"))


class SessionManager:
    def __init__(self, db_path: str = None):
        """Initialize SessionManager. If db_path is provided, use it; otherwise use SESSION_FILE."""
        if db_path:
            self.db_path = os.path.abspath(db_path)
        else:
            self.db_path = SESSION_FILE
        self._ensure_db_exists()
    
    def _ensure_db_exists(self):
        """Create the database file if it doesn't exist."""
        if not os.path.exists(self.db_path):
            with open(self.db_path, 'w') as f:
                json.dump({}, f, indent=4)
    
    def save_session(self, platform: str, data: Dict[str, Any]) -> None:
        """Save session data for a platform."""
        print(f"DEBUG: Attempting to save to: {self.db_path}")
        
        # Load existing data first (if file exists) so we don't overwrite other platforms
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, 'r') as f:
                    full_data = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"DEBUG: Error reading existing file: {e}, starting fresh")
                full_data = {}
        else:
            full_data = {}
        
        # Update the specific platform key
        full_data[platform] = data
        
        # Get cookie count for logging
        cookie_count = len(data.get("cookies", [])) if isinstance(data.get("cookies"), list) else 0
        print(f"💾 Saving [{cookie_count}] cookies to disk...")
        
        # FORCE the write using standard synchronous open
        with open(self.db_path, 'w') as f:
            json.dump(full_data, f, indent=4)
        
        print(f"DEBUG: Successfully wrote {len(full_data)} items to disk.")
    
    def get_session(self, platform: str) -> Optional[Dict[str, Any]]:
        """Get session data for a platform."""
        if not os.path.exists(self.db_path):
            return None
        
        try:
            with open(self.db_path, 'r') as f:
                sessions = json.load(f)
            return sessions.get(platform)
        except (json.JSONDecodeError, IOError) as e:
            print(f"DEBUG: Error reading session file: {e}")
            return None
    
    # Keep async versions for backward compatibility, but they just call sync versions
    async def save_session_async(self, platform: str, data: Dict[str, Any]) -> None:
        """Async wrapper for save_session."""
        self.save_session(platform, data)
    
    async def get_session_async(self, platform: str) -> Optional[Dict[str, Any]]:
        """Async wrapper for get_session."""
        return self.get_session(platform)

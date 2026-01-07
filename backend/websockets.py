from typing import Dict, List
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        # Key = Room ID (e.g., "sidebar", "chat_user123")
        self.rooms: Dict[str, List[WebSocket]] = {}
        self.cached_sidebar_state = None

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = []
        self.rooms[room_id].append(websocket)
        
        # Immediate sync for sidebar if we have a cache
        if room_id == "sidebar" and self.cached_sidebar_state:
            print(f"🔄 [WS] Sending cached sidebar state to new connection")
            try:
                await websocket.send_json(self.cached_sidebar_state)
            except Exception as e:
                print(f"⚠️ Failed to send cache: {e}")

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.rooms and websocket in self.rooms[room_id]:
            self.rooms[room_id].remove(websocket)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast(self, room_id: str, message: dict):
        # Cache sidebar updates so late joiners get state
        if room_id == "sidebar":
            self.cached_sidebar_state = message
            
        if room_id in self.rooms:
            for connection in self.rooms[room_id]:
                try:
                    await connection.send_json(message)
                except:
                    self.disconnect(connection, room_id)

    def is_active(self, chat_id: str) -> bool:
        """Checks if any frontend user is currently connected to this chat room."""
        room_name = f"chat_{chat_id}"
        return room_name in self.rooms and len(self.rooms[room_name]) > 0

manager = ConnectionManager()
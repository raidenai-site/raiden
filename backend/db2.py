# backend/db2.py
"""
Message Storage for AI Assistant
Uses pure SQLite for keyword search (removed vector/fastembed support)
"""

import sqlite3
import json
import os
from typing import Optional, List, Dict, Any
from pathlib import Path

# Database path - use AppData on Windows for writable location
def get_data_dir() -> Path:
    """Get the data directory for storing databases"""
    if os.name == 'nt':  # Windows
        base = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
    else:
        base = Path.home() / '.local' / 'share'
    
    data_dir = base / 'Raiden'
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

DB_PATH = get_data_dir() / "raiden_messages.db"


def get_connection() -> sqlite3.Connection:
    """Get database connection"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database schema"""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Messages table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            message_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            text TEXT NOT NULL,
            sort_score INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Index for fast chat lookups
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_messages_chat_id 
        ON messages(chat_id)
    """)
    
    conn.commit()
    conn.close()
    print(f"✅ Database initialized at {DB_PATH}")


def add_messages(messages: List[Dict[str, Any]], generate_embeddings: bool = False) -> int:
    """
    Add messages to db2 with deduplication by message_id.
    
    Args:
        messages: List of message dicts with keys:
            - message_id: Instagram's unique ID (mid.xxxxx)
            - chat_id: Username/chat identifier  
            - sender: "Me", "Them", or username
            - text: Message content
            - sort_score: Chronological ordering score
    
    Returns:
        Number of new messages added
    """
    if not messages:
        return 0
    
    conn = get_connection()
    cursor = conn.cursor()
    
    new_count = 0
    
    for msg in messages:
        # Skip if already exists
        cursor.execute(
            "SELECT 1 FROM messages WHERE message_id = ?", 
            (msg["message_id"],)
        )
        if cursor.fetchone():
            continue
        
        # Insert new message
        cursor.execute("""
            INSERT INTO messages (message_id, chat_id, sender, text, sort_score)
            VALUES (?, ?, ?, ?, ?)
        """, (
            msg["message_id"],
            msg["chat_id"],
            msg["sender"],
            msg["text"],
            msg.get("sort_score", 0)
        ))
        
        new_count += 1
    
    conn.commit()
    conn.close()
    
    if new_count > 0:
        print(f"💾 Added {new_count} new messages to db2")
    
    return new_count


def search_keyword(
    query: str,
    chat_id: Optional[str] = None,
    limit: int = 20
) -> List[Dict[str, Any]]:
    """
    Simple keyword search using LIKE.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    query_pattern = f"%{query}%"
    
    if chat_id:
        cursor.execute("""
            SELECT * FROM messages 
            WHERE chat_id = ? AND text LIKE ?
            ORDER BY sort_score DESC
            LIMIT ?
        """, (chat_id, query_pattern, limit))
    else:
        cursor.execute("""
            SELECT * FROM messages 
            WHERE text LIKE ?
            ORDER BY sort_score DESC  
            LIMIT ?
        """, (query_pattern, limit))
    
    results = []
    for row in cursor.fetchall():
        results.append({
            "message_id": row["message_id"],
            "chat_id": row["chat_id"],
            "sender": row["sender"],
            "text": row["text"],
            "sort_score": row["sort_score"]
        })
    
    conn.close()
    return results


def get_messages_by_chat(chat_id: str, limit: int = 500) -> List[Dict[str, Any]]:
    """Get messages for a specific chat.
    Fetches the MOST RECENT {limit} messages, then returns them in chronological order.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # Use LIKE for fuzzy matching (case-insensitive by default in SQLite)
    # Order by DESC to get the latest ones first
    cursor.execute("""
        SELECT * FROM messages 
        WHERE chat_id LIKE ?
        ORDER BY sort_score DESC
        LIMIT ?
    """, (f"%{chat_id}%", limit))
    
    rows = cursor.fetchall()
    
    results = []
    for row in rows:
        results.append({
            "message_id": row["message_id"],
            "chat_id": row["chat_id"],
            "sender": row["sender"],
            "text": row["text"],
            "sort_score": row["sort_score"]
        })
    
    conn.close()
    # Reverse to return oldest -> newest
    return results[::-1]


def get_my_messages(limit: int = 100) -> List[str]:
    """
    Get messages sent by 'Me' across all chats.
    Used to provide writing style examples for AI.
    
    Returns:
        List of message texts (strings only)
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Get recent messages from "Me", ordered by most recent first
        cursor.execute("""
            SELECT DISTINCT text FROM messages 
            WHERE sender = 'Me' AND length(text) > 5
            ORDER BY sort_score DESC
            LIMIT ?
        """, (limit,))
        
        results = [row["text"] for row in cursor.fetchall()]
        return results
    except Exception as e:
        print(f"⚠️ Error getting my messages: {e}")
        return []
    finally:
        conn.close()


def get_recent_messages(limit: int = 25) -> List[Dict[str, Any]]:
    """
    Get the most recently added messages to the database.
    
    Args:
        limit: Maximum number of messages to return
    
    Returns:
        List of message dicts ordered by most recent first
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT * FROM messages 
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))
        
        results = []
        for row in cursor.fetchall():
            results.append({
                "chat_id": row["chat_id"],
                "sender": row["sender"],
                "text": row["text"],
            })
        
        return results
    except Exception as e:
        print(f"⚠️ Error getting recent messages: {e}")
        return []
    finally:
        conn.close()


def get_stats() -> Dict[str, Any]:
    """Get statistics about stored messages"""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Total messages
    cursor.execute("SELECT COUNT(*) as count FROM messages")
    total = cursor.fetchone()["count"]
    
    # Messages per chat
    cursor.execute("""
        SELECT chat_id, COUNT(*) as count 
        FROM messages 
        GROUP BY chat_id
        ORDER BY count DESC
    """)
    
    chats = []
    for row in cursor.fetchall():
        chats.append({
            "chat_id": row["chat_id"],
            "message_count": row["count"]
        })
    
    conn.close()
    
    return {
        "total_messages": total,
        "chats": chats
    }


# ============================================================
# TESTING
# ============================================================

if __name__ == "__main__":
    print(get_recent_messages(limit=25))

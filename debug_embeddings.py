"""
Debug script to test embedding search queries in db2.
Run this to see how search_similar and get_messages_by_chat work.
"""
import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent))

from backend.db2 import (
    init_db, 
    search_similar, 
    get_messages_by_chat, 
    get_stats,
    search_keyword
)

def main():
    print("🔍 DB2 Embedding Debug Tool")
    print("=" * 50)
    
    # Initialize
    init_db()
    
    # Get stats
    stats = get_stats()
    print(f"\n📊 Database Stats:")
    print(f"   Total messages: {stats['total_messages']}")
    print(f"   Chats: {len(stats['chats'])}")
    
    if stats['chats']:
        print(f"\n📋 Available Chats:")
        for chat in stats['chats'][:10]:  # Show first 10
            print(f"   - {chat['chat_id']} ({chat['message_count']} msgs)")
    
    print("\n" + "=" * 50)
    print("Commands:")
    print("  s <query>       - Semantic search (embeddings)")
    print("  k <query>       - Keyword search (LIKE)")
    print("  c <username>    - Get conversation")
    print("  q               - Quit")
    print("=" * 50)
    
    while True:
        try:
            cmd = input("\n>>> ").strip()
        except (KeyboardInterrupt, EOFError):
            break
        
        if not cmd:
            continue
        
        if cmd.lower() == "q":
            break
        
        parts = cmd.split(" ", 1)
        action = parts[0].lower()
        query = parts[1] if len(parts) > 1 else ""
        
        if action == "s" and query:
            print(f"\n🔍 Semantic search: '{query}'")
            results = search_similar(query, limit=10)
            if not results:
                print("   No results found.")
            else:
                for r in results:
                    sim = f" (sim: {r['similarity']:.3f})" if r.get('similarity') else ""
                    text = r['text'][:80] + "..." if len(r['text']) > 80 else r['text']
                    print(f"   [{r['chat_id']}] {r['sender']}: {text}{sim}")
        
        elif action == "k" and query:
            print(f"\n🔍 Keyword search: '{query}'")
            results = search_keyword(query, limit=10)
            if not results:
                print("   No results found.")
            else:
                for r in results:
                    text = r['text'][:80] + "..." if len(r['text']) > 80 else r['text']
                    print(f"   [{r['chat_id']}] {r['sender']}: {text}")
        
        elif action == "c" and query:
            print(f"\n💬 Conversation: '{query}'")
            messages = get_messages_by_chat(query, limit=20)
            if not messages:
                print("   No messages found for this chat.")
            else:
                for m in messages:
                    text = m['text'][:80] + "..." if len(m['text']) > 80 else m['text']
                    print(f"   {m['sender']}: {text}")
        
        else:
            print("   Invalid command. Use s/k/c <query> or q to quit.")
    
    print("\n👋 Bye!")

if __name__ == "__main__":
    main()

# backend/assistant.py
"""
AI Assistant with RAG + Tool calling using Supabase Edge Functions.
API keys are secured server-side - no direct AI calls from client.

The edge function handles the LLM calls, and this module executes tools locally.
"""

from typing import Optional, List, Dict, Any
from backend.db2 import search_keyword, get_messages_by_chat, get_stats, get_recent_messages, init_db as db2_init
from backend.edge_client import ask_assistant_via_edge


def _execute_tool(name: str, args: dict) -> str:
    """Execute a tool and return the result."""
    print(f"🔧 [TOOL] Executing {name} with args: {args}")
    
    if name == "search_messages":
        results = search_keyword(query=args["query"], limit=20)
        if not results:
            return "No messages found matching that query."
        formatted = []
        for r in results:
            formatted.append(f"[{r['chat_id']}] {r['sender']}: {r['text']}")
        return "\n".join(formatted)
    
    elif name == "get_conversation":
        username = args["username"]
        messages = get_messages_by_chat(chat_id=username, limit=500)
        if not messages:
            return f"No messages found for '{username}'. They may need to view that chat first in the app."
        formatted = []
        for m in messages:
            formatted.append(f"{m.get('sender', 'Unknown')}: {m.get('text', '')}")
        print(f"🔧 [TOOL] Found {len(messages)} messages for '{username}'")
        return "\n".join(formatted)
    
    elif name == "list_chats":
        stats = get_stats()
        if not stats.get("chats"):
            return "No chats stored yet. User needs to view some chats first to populate the database."
        formatted = []
        for chat in stats["chats"]:
            formatted.append(f"- {chat['chat_id']} ({chat['message_count']} messages)")
        print(f"🔧 [TOOL] Listed {len(stats['chats'])} chats")
        return f"Available chats:\n" + "\n".join(formatted)
    
    return f"Unknown tool: {name}"


async def ask_assistant(
    question: str,
    bot=None,
    max_iterations: int = 5,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Main AI Assistant endpoint with function calling support.
    
    Uses edge function for LLM calls, executes tools locally.
    
    Args:
        question: User's question
        bot: Instagram bot instance (optional, for future use)
        max_iterations: Max tool-calling iterations
        auth_token: JWT token for authenticating with edge function
    
    Returns:
        Dict with 'answer', 'sources', and 'tool_used'
    """
    
    # Initialize db2 if needed
    db2_init()
    
    # Get initial context via keyword search (replaced semantic search)
    initial_context_results = f"""
    Most recent messages:
    {get_recent_messages(limit=25)}
    
    Keyword search:
    {search_keyword(query=question, limit=25)}
    """
    sources = []
    
    context_text = initial_context_results
    
    tool_used = False
    messages = None
    
    try:
        for iteration in range(max_iterations):
            # Call edge function
            if messages is None:
                # First call
                response = await ask_assistant_via_edge(
                    question=question,
                    initial_context=context_text if context_text else None,
                    auth_token=auth_token
                )
            else:
                # Follow-up call with tool results
                response = await ask_assistant_via_edge(
                    question=question,
                    tool_results=tool_results,
                    messages=messages,
                    auth_token=auth_token
                )
            
            if "error" in response:
                return {
                    "answer": f"Sorry, I encountered an error: {response['error']}",
                    "sources": sources[:10],
                    "tool_used": False
                }
            
            # Check if tools need to be called
            if response.get("needs_tools"):
                tool_used = True
                messages = response.get("messages", [])
                tool_calls = response.get("tool_calls", [])
                
                # Execute tools locally
                tool_results = []
                for tc in tool_calls:
                    result = _execute_tool(tc["name"], tc["arguments"])
                    tool_results.append({
                        "tool_call_id": tc["id"],
                        "name": tc["name"],
                        "result": result
                    })
                
                # Continue loop to send results back
                continue
            
            # No more tool calls, we have the final answer
            answer = response.get("answer", "I couldn't generate a response.")
            print(f"🔧 [ASSISTANT] Response generated (tools_used={tool_used})")
            
            return {
                "answer": answer,
                "sources": sources[:10],
                "tool_used": tool_used
            }
        
        # Max iterations reached
        return {
            "answer": "Sorry, I couldn't complete the request in time.",
            "sources": sources[:10],
            "tool_used": tool_used
        }
        
    except Exception as e:
        print(f"❌ Assistant error: {e}")
        return {
            "answer": f"Sorry, I encountered an error: {str(e)}",
            "sources": sources[:10],
            "tool_used": False
        }


def get_assistant_stats() -> Dict[str, Any]:
    """Get statistics about what the assistant has access to"""
    return get_stats()

# backend/edge_client.py
"""
Centralized client for calling Supabase Edge Functions.
Handles auth token passing, error handling, and retries.
"""

import os
import aiohttp
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL not set in environment")
if not SUPABASE_ANON_KEY:
    raise RuntimeError("SUPABASE_ANON_KEY not set in environment")

# Base URL for edge functions
EDGE_FUNCTIONS_URL = f"{SUPABASE_URL}/functions/v1"


async def call_edge_function(
    function_name: str,
    payload: Dict[str, Any],
    auth_token: Optional[str] = None,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Call a Supabase Edge Function.
    
    Args:
        function_name: Name of the edge function (e.g., 'generate-reply')
        payload: JSON payload to send
        auth_token: JWT token for authentication (required for protected functions)
        timeout: Request timeout in seconds
    
    Returns:
        JSON response from the edge function
    
    Raises:
        EdgeFunctionError: If the request fails
    """
    url = f"{EDGE_FUNCTIONS_URL}/{function_name}"
    
    headers = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
    }
    
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout)
            ) as response:
                data = await response.json()
                
                if response.status == 401:
                    raise EdgeFunctionError("Authentication required", status=401)
                elif response.status == 429:
                    raise EdgeFunctionError("Rate limit exceeded", status=429, data=data)
                elif response.status >= 400:
                    error_msg = data.get("error", "Unknown error")
                    raise EdgeFunctionError(error_msg, status=response.status, data=data)
                
                return data
                
    except aiohttp.ClientError as e:
        raise EdgeFunctionError(f"Network error: {str(e)}", status=0)
    except Exception as e:
        if isinstance(e, EdgeFunctionError):
            raise
        raise EdgeFunctionError(f"Unexpected error: {str(e)}", status=0)


class EdgeFunctionError(Exception):
    """Exception raised when an edge function call fails."""
    
    def __init__(self, message: str, status: int = 0, data: Optional[Dict] = None):
        super().__init__(message)
        self.status = status
        self.data = data or {}


# ============================================================
# CONVENIENCE FUNCTIONS
# ============================================================

async def generate_reply_via_edge(
    chat_id: str,
    transcript: str,
    profile: Dict[str, Any],
    rules: Optional[str] = None,
    writing_examples: Optional[str] = None,
    is_starter: bool = False,
    auth_token: Optional[str] = None,
    relevant_context: Optional[str] = None
) -> Optional[str]:
    """
    Generate a smart reply using the edge function.
    
    Returns the generated reply text, or None on error.
    """
    try:
        result = await call_edge_function(
            "generate-reply",
            {
                "chat_id": chat_id,
                "transcript": transcript,
                "profile": profile,
                "rules": rules,
                "writing_examples": writing_examples,
                "is_starter": is_starter,
                "relevant_context": relevant_context
            },
            auth_token=auth_token,
            timeout=30
        )
        return result.get("reply")
    except EdgeFunctionError as e:
        print(f"❌ Edge function error: {e}")
        return None


async def generate_profile_via_edge(
    transcript: str,
    auth_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Generate a typing profile using the edge function.
    
    Returns the profile dict, or None on error.
    """
    try:
        result = await call_edge_function(
            "generate-profile",
            {"transcript": transcript},
            auth_token=auth_token,
            timeout=60  # Profile generation can take longer
        )
        return result.get("profile")
    except EdgeFunctionError as e:
        print(f"❌ Edge function error: {e}")
        return None


async def ask_assistant_via_edge(
    question: str,
    initial_context: Optional[str] = None,
    tool_results: Optional[list] = None,
    messages: Optional[list] = None,
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Query the AI assistant using the edge function.
    
    Returns response dict with either 'answer' or 'tool_calls'.
    """
    try:
        payload = {"question": question}
        if initial_context:
            payload["initial_context"] = initial_context
        if tool_results:
            payload["tool_results"] = tool_results
        if messages:
            payload["messages"] = messages
            
        return await call_edge_function(
            "ask-assistant",
            payload,
            auth_token=auth_token,
            timeout=60
        )
    except EdgeFunctionError as e:
        print(f"❌ Edge function error: {e}")
        return {"error": str(e), "needs_tools": False}


async def check_rate_limit_via_edge(
    action: str = "check",
    tier: str = "free",
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Check or update rate limit status via edge function.
    
    Args:
        action: 'check', 'increment', or 'status'
        tier: 'free' or 'paid'
    
    Returns:
        Rate limit status dict
    """
    try:
        return await call_edge_function(
            "check-rate-limit",
            {"action": action, "tier": tier},
            auth_token=auth_token,
            timeout=10
        )
    except EdgeFunctionError as e:
        print(f"❌ Edge function error: {e}")
        # Fail open - allow request if rate limit check fails
        return {"allowed": True, "error": str(e)}


async def validate_membership_via_edge(
    auth_token: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get user's membership tier via edge function.
    
    Returns:
        Membership info dict with tier and limits
    """
    try:
        return await call_edge_function(
            "validate-membership",
            {},
            auth_token=auth_token,
            timeout=10
        )
    except EdgeFunctionError as e:
        print(f"❌ Edge function error: {e}")
        # Default to free tier on error
        return {
            "tier": "free",
            "limits": {
                "window_hours": 4,
                "max_requests": 26,
                "cooldown_hours": 2
            },
            "error": str(e)
        }

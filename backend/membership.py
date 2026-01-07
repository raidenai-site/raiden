# backend/membership.py
import os
from typing import Optional
from dotenv import load_dotenv

# Import supabase - must be imported before backend.websockets to avoid naming conflict
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")

# Create Supabase client with service role key (bypasses RLS for backend operations)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)



async def get_user_tier(user_id: str) -> str:
    """
    Get user's membership tier from Supabase users table.
    Returns 'free' or 'paid', defaults to 'free' if not found.
    """
    try:
        response = supabase.table("users").select("tier").eq("id", user_id).execute()
        
        if response.data and len(response.data) > 0:
            tier = response.data[0].get("tier", "free")
            return tier if tier in ["free", "paid"] else "free"
        
        # User doesn't exist in users table, create with free tier
        supabase.table("users").insert({
            "id": user_id,
            "tier": "free"
        }).execute()
        return "free"
        
    except Exception as e:
        print(f"⚠️ Error getting user tier: {e}")
        return "free"  # Default to free on error


async def create_user_if_not_exists(user_id: str) -> None:
    """
    Create user record in Supabase if it doesn't exist.
    Sets default tier to 'free'.
    """
    try:
        # Check if user exists
        response = supabase.table("users").select("id").eq("id", user_id).execute()
        
        if not response.data or len(response.data) == 0:
            # User doesn't exist, create with free tier
            supabase.table("users").insert({
                "id": user_id,
                "tier": "free"
            }).execute()
            print(f"✅ Created user {user_id} with free tier")
    except Exception as e:
        print(f"⚠️ Error creating user: {e}")


async def update_user_tier(user_id: str, tier: str) -> bool:
    """
    Update user's tier in Supabase.
    Returns True if successful, False otherwise.
    """
    if tier not in ["free", "paid"]:
        return False
    
    try:
        supabase.table("users").update({"tier": tier}).eq("id", user_id).execute()
        return True
    except Exception as e:
        print(f"⚠️ Error updating user tier: {e}")
        return False


async def get_customer_id(user_id: str) -> Optional[str]:
    """
    Get DodoPayments customer_id for a user.
    """
    try:
        response = supabase.table("users").select("customer_id").eq("id", user_id).execute()
        if response.data and len(response.data) > 0:
            return response.data[0].get("customer_id")
        return None
    except Exception as e:
        print(f"⚠️ Error returning customer_id: {e}")
        return None


def check_auto_reply_limit(tier: str, current_count: int) -> tuple[bool, int, int]:
    """
    Check if user can enable tracking for another chat based on their tier.
    
    Args:
        tier: User's tier ('free' or 'paid')
        current_count: Current number of tracked chats
    
    Returns:
        Tuple of (is_allowed, current_count, limit)
    """
    # Free tier: 2 chats, Paid tier: unlimited
    if tier == "paid":
        return True, current_count, -1  # -1 = unlimited
    
    limit = 2
    is_allowed = current_count < limit
    
    return is_allowed, current_count, limit


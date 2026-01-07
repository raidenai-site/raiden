# backend/rate_limiter.py
"""
Local rate limiting for LLM requests.
Persists state in SQLite to survive restarts.

Parameters:
- WINDOW_HOURS: 6 hours
- MAX_REQUESTS: 50 requests per window
- COOLDOWN_HOURS: 1 hour after hitting limit
"""

from datetime import datetime, timedelta
from typing import Optional, Tuple
from backend.models import SessionLocal, RateLimitState

# Configuration by tier
RATE_LIMITS = {
    "free": {
        "window_hours": 4,
        "max_requests": 26,
        "cooldown_hours": 2
    },
    "paid": {
        "window_hours": 6,
        "max_requests": 80,
        "cooldown_hours": 1
    }
}

# Default fallback (used when tier not provided)
WINDOW_HOURS = RATE_LIMITS["free"]["window_hours"]
MAX_REQUESTS = RATE_LIMITS["free"]["max_requests"]
COOLDOWN_HOURS = RATE_LIMITS["free"]["cooldown_hours"]


def get_limits_for_tier(tier: str = "free") -> dict:
    """Get rate limit config for a given tier."""
    return RATE_LIMITS.get(tier, RATE_LIMITS["free"])


def _get_or_create_state() -> RateLimitState:
    """Get or create the single rate limit state row."""
    db = SessionLocal()
    try:
        state = db.query(RateLimitState).filter(RateLimitState.id == 1).first()
        if not state:
            state = RateLimitState(id=1, request_count=0, window_start=datetime.utcnow())
            db.add(state)
            db.commit()
            db.refresh(state)
        return state
    finally:
        db.close()


def check_rate_limit(tier: str = "free") -> Tuple[bool, Optional[datetime]]:
    """
    Check if a request is allowed under rate limits.
    
    Args:
        tier: User tier ("free" or "paid")
    
    Returns:
        Tuple of (is_allowed, reset_time_if_blocked)
        - is_allowed: True if request can proceed
        - reset_time_if_blocked: datetime when limit resets (only if blocked)
    """
    limits = get_limits_for_tier(tier)
    window_hours = limits["window_hours"]
    max_requests = limits["max_requests"]
    cooldown_hours = limits["cooldown_hours"]
    
    db = SessionLocal()
    try:
        state = db.query(RateLimitState).filter(RateLimitState.id == 1).first()
        
        if not state:
            # First time - create state
            state = RateLimitState(id=1, request_count=0, window_start=datetime.utcnow())
            db.add(state)
            db.commit()
            return (True, None)
        
        now = datetime.utcnow()
        
        # Check 1: Are we in cooldown?
        if state.cooldown_until and now < state.cooldown_until:
            print(f"⏳ Rate limit [{tier}]: In cooldown until {state.cooldown_until}")
            return (False, state.cooldown_until)
        
        # Check 2: Has cooldown expired? Reset everything
        if state.cooldown_until and now >= state.cooldown_until:
            print(f"✅ Rate limit [{tier}]: Cooldown expired, resetting counter")
            state.request_count = 0
            state.window_start = now
            state.cooldown_until = None
            db.commit()
            return (True, None)
        
        # Check 3: Has the window expired? Reset counter
        window_end = state.window_start + timedelta(hours=window_hours)
        if now >= window_end:
            print(f"✅ Rate limit [{tier}]: Window expired, resetting counter")
            state.request_count = 0
            state.window_start = now
            db.commit()
            return (True, None)
        
        # Check 4: Are we at the limit?
        if state.request_count >= max_requests:
            # Enter cooldown
            cooldown_end = now + timedelta(hours=cooldown_hours)
            state.cooldown_until = cooldown_end
            db.commit()
            print(f"🚫 Rate limit [{tier}]: Limit reached ({state.request_count}/{max_requests}), cooldown until {cooldown_end}")
            return (False, cooldown_end)
        
        # All checks passed
        return (True, None)
    
    finally:
        db.close()


def increment_request_count(tier: str = "free") -> int:
    """
    Increment the request counter after a successful LLM call.
    
    Args:
        tier: User tier ("free" or "paid")
    
    Returns:
        The new request count
    """
    limits = get_limits_for_tier(tier)
    max_requests = limits["max_requests"]
    
    db = SessionLocal()
    try:
        state = db.query(RateLimitState).filter(RateLimitState.id == 1).first()
        
        if not state:
            state = RateLimitState(id=1, request_count=1, window_start=datetime.utcnow())
            db.add(state)
        else:
            state.request_count += 1
        
        db.commit()
        print(f"📊 Rate limit [{tier}]: {state.request_count}/{max_requests} requests used")
        return state.request_count
    
    finally:
        db.close()


def get_rate_limit_status(tier: str = "free") -> dict:
    """
    Get current rate limit status for debugging/UI.
    
    Args:
        tier: User tier ("free" or "paid")
    
    Returns:
        Dict with current_count, max_requests, window_start, cooldown_until, is_limited
    """
    limits = get_limits_for_tier(tier)
    window_hours = limits["window_hours"]
    max_requests = limits["max_requests"]
    cooldown_hours = limits["cooldown_hours"]
    
    db = SessionLocal()
    try:
        state = db.query(RateLimitState).filter(RateLimitState.id == 1).first()
        
        if not state:
            return {
                "tier": tier,
                "current_count": 0,
                "max_requests": max_requests,
                "window_hours": window_hours,
                "cooldown_hours": cooldown_hours,
                "window_start": None,
                "cooldown_until": None,
                "is_limited": False
            }
        
        now = datetime.utcnow()
        is_limited = (
            (state.cooldown_until and now < state.cooldown_until) or
            state.request_count >= max_requests
        )
        
        return {
            "tier": tier,
            "current_count": state.request_count,
            "max_requests": max_requests,
            "window_hours": window_hours,
            "cooldown_hours": cooldown_hours,
            "window_start": state.window_start.isoformat() if state.window_start else None,
            "cooldown_until": state.cooldown_until.isoformat() if state.cooldown_until else None,
            "is_limited": is_limited
        }
    
    finally:
        db.close()


def format_reset_time(reset_at: datetime) -> str:
    """Format reset time for user-friendly display."""
    # Convert to local time display (user sees their local time)
    return reset_at.strftime("%I:%M %p")

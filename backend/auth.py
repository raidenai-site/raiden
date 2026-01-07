# backend/auth.py
import os
from typing import Optional
from fastapi import HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
# Check for both possible env var names for JWT secret
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET") or os.getenv("SUPABASE_JWT_KEY")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL must be set in .env")

# Note: Supabase JWT secret is found in Project Settings > API > JWT Secret
# If not set, we'll decode without verification (less secure, but works for development)
# In production, always verify the signature

security = HTTPBearer(auto_error=False)  # Don't auto-raise, handle manually


async def verify_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[str]:
    """
    Verify Supabase JWT token and return user_id.
    Returns None if no token provided (for optional auth endpoints).
    Raises HTTPException if token is invalid.
    """
    if not credentials:
        return None
    
    token = credentials.credentials
    print(f"🔐 Token received: {token[:50]}..." if len(token) > 50 else f"🔐 Token: {token}")
    print(f"🔑 JWT Secret configured: {'Yes' if SUPABASE_JWT_SECRET else 'No'}")
    
    try:
        # Decode token to get payload
        # Supabase uses 'sub' claim for user_id
        if SUPABASE_JWT_SECRET:
            print(f"🔓 Verifying with secret (first 20 chars): {SUPABASE_JWT_SECRET[:20]}...")
            # Verify signature if JWT secret is provided
            decoded = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_exp": True, "verify_aud": False}  # Disable audience verification
            )
        else:
            # Development mode: decode without verification
            # WARNING: Not secure, only for development
            # Need to provide a dummy key when verify_signature=False
            # Also disable audience verification for development
            decoded = jwt.decode(
                token,
                key="",  # Dummy key when not verifying
                options={
                    "verify_signature": False,
                    "verify_exp": False,
                    "verify_aud": False  # Disable audience verification
                }
            )
            print("⚠️ WARNING: JWT verification disabled. Set SUPABASE_JWT_SECRET in .env for production.")
        
        user_id = decoded.get("sub")  # Supabase uses 'sub' claim for user_id
        
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no user_id")
        
        print(f"✅ Token verified! user_id={user_id}")
        return user_id
        
    except jwt.ExpiredSignatureError:
        print("❌ Token expired!")
        raise HTTPException(status_code=401, detail="Token expired")
    except JWTError as e:
        print(f"❌ JWT Error: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Token verification failed: {str(e)}")


def get_current_user_id(user_id: Optional[str] = Depends(verify_token)) -> str:
    """
    Dependency to get current user_id from verified token.
    Raises 401 if no token provided.
    """
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


async def get_current_auth_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[str]:
    """
    Dependency to get the raw JWT token for passing to edge functions.
    Returns None if no token provided.
    """
    if not credentials:
        return None
    return credentials.credentials


def require_auth_token(
    token: Optional[str] = Depends(get_current_auth_token)
) -> str:
    """
    Dependency to require auth token for edge function calls.
    Raises 401 if no token provided.
    """
    if token is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return token


def decode_user_id_from_token(token: str) -> Optional[str]:
    """
    Decode user_id from a JWT token string.
    Can be used outside FastAPI (e.g., in background tasks).
    Returns None if token is invalid.
    """
    try:
        if SUPABASE_JWT_SECRET:
            decoded = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_exp": True, "verify_aud": False}
            )
        else:
            decoded = jwt.decode(
                token,
                key="",
                algorithms=["HS256"],
                options={"verify_signature": False, "verify_exp": False, "verify_aud": False}
            )
        
        return decoded.get("sub")
    except Exception as e:
        print(f"⚠️ Failed to decode token: {e}")
        return None

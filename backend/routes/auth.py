"""Authentication routes"""

import logging
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from utils.auth import USERS, generate_token, verify_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    mode: str

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    Simple login endpoint
    Returns token and mode
    """
    username = request.username.strip()
    password = request.password.strip()
    
    logger.info(f"🔍 Login attempt - username: '{username}', password: '{password}'")
    logger.info(f"🔍 USERS dict: {USERS}")
    logger.info(f"🔍 Username in USERS: {username in USERS}")
    if username in USERS:
        logger.info(f"🔍 Password match: {USERS[username] == password} (stored: '{USERS[username]}', provided: '{password}')")
    
    # Verify credentials
    if username not in USERS or USERS[username] != password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    # Generate token
    token = generate_token(username)
    mode = "mode1"  # Default mode
    
    logger.info(f"✅ User {username} logged in")
    
    return LoginResponse(
        access_token=token,
        token_type="Bearer",
        mode=mode
    )

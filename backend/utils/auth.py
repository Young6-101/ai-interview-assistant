"""Authentication utilities"""

import base64
import time
from typing import Optional

# Hardcoded users - ONLY place where users are defined
# hr1: password is 123
# hr2: password is 456  
# admin: password is 000
USERS = {
    "hr1": "123",
    "hr2": "456",
    "admin": "000"
}

def generate_token(username: str) -> str:
    """Generate simple token"""
    payload = f"{username}:{int(time.time())}"
    return base64.b64encode(payload.encode()).decode()

def verify_token(token: str) -> Optional[str]:
    """Verify token and return username"""
    try:
        decoded = base64.b64decode(token.encode()).decode()
        username = decoded.split(":")[0]
        if username in USERS:
            return username
        return None
    except:
        return None


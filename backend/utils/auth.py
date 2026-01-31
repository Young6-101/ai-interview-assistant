"""Authentication utilities"""

import base64
import time
from typing import Optional

def generate_token(subject: str) -> str:
    """Generate simple token"""
    payload = f"{subject}:{int(time.time())}"
    return base64.b64encode(payload.encode()).decode()

def verify_token(token: str) -> Optional[str]:
    """Decode token and return the stored subject"""
    try:
        decoded = base64.b64decode(token.encode()).decode()
        return decoded.split(":")[0]
    except Exception:
        return None


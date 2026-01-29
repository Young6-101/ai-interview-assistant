"""Global state management for interview sessions"""

import asyncio
from typing import Dict, List, Any
from fastapi import WebSocket

# Global state
interview_sessions: Dict[str, Dict[str, Any]] = {}
active_websockets: List[WebSocket] = []
state_lock = asyncio.Lock()

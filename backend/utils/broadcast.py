"""Broadcast utilities"""

import logging
from typing import Dict, Any
from core.state import active_websockets

logger = logging.getLogger(__name__)

async def broadcast_update(message: Dict[str, Any]):
    """Broadcast message to all connected WebSockets"""
    for websocket in active_websockets:
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Broadcast error: {e}")
            try:
                active_websockets.remove(websocket)
            except:
                pass

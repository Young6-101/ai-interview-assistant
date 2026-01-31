"""Interview routes - REST API and WebSocket"""

import os
import json
import time
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from utils.auth import verify_token
from utils.broadcast import broadcast_update
from core.state import interview_sessions, active_websockets, state_lock

logger = logging.getLogger(__name__)

router = APIRouter(tags=["interview"])

# ============ MODELS ============

class CreateInterviewRequest(BaseModel):
    candidate_name: str
    candidate_email: Optional[str] = None
    mode: str = "mode1"

class SaveInterviewRequest(BaseModel):
    transcripts: list
    weak_points: list
    questions_asked: list = []
    suggested_questions: list = []

# ============ REST API ENDPOINTS ============

@router.post("/api/interview/create")
async def create_interview(request: CreateInterviewRequest):
    """Create new interview"""
    interview_id = f"interview_{int(time.time())}"
    
    async with state_lock:
        interview_sessions[interview_id] = {
            "id": interview_id,
            "candidate_name": request.candidate_name,
            "candidate_email": request.candidate_email,
            "mode": request.mode,
            "status": "created",
            "start_time": datetime.now().isoformat(),
            "transcripts": [],
            "weak_points": []
        }
    
    logger.info(f"✨ Interview created: {interview_id}")
    
    return {
        "id": interview_id,
        "candidate_name": request.candidate_name,
        "candidate_email": request.candidate_email,
        "mode": request.mode,
        "status": "created",
        "start_time": datetime.now().isoformat(),
        "transcripts": [],
        "weak_points": []
    }

@router.post("/api/interview/{interview_id}/save")
async def save_interview(interview_id: str, request: SaveInterviewRequest):
    """Save interview data"""
    async with state_lock:
        if interview_id in interview_sessions:
            interview_sessions[interview_id]["transcripts"] = request.transcripts
            interview_sessions[interview_id]["weak_points"] = request.weak_points
            interview_sessions[interview_id]["questions_asked"] = request.questions_asked
            interview_sessions[interview_id]["suggested_questions"] = request.suggested_questions
            interview_sessions[interview_id]["end_time"] = datetime.now().isoformat()
            
            # Save to JSON file
            filename = f"interviews/{interview_id}.json"
            os.makedirs("interviews", exist_ok=True)
            with open(filename, "w") as f:
                json.dump(interview_sessions[interview_id], f, indent=2)
            
            logger.info(f"💾 Interview saved: {filename}")
            
            return {"message": "Interview saved successfully"}
    
    return {"error": "Interview not found"}

# ============ WEBSOCKET ENDPOINT ============

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time interview
    """
    try:
        await websocket.accept()
        active_websockets.append(websocket)
        logger.info(f"✅ WebSocket accepted from {websocket.client}")
    except Exception as e:
        logger.error(f"❌ WebSocket accept failed: {e}")
        raise
    
    session_id = None
    is_paused = False
    
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception as e:
                # Connection closed or invalid JSON
                logger.debug(f"WebSocket receive error (connection closed?): {type(e).__name__}")
                break
            
            message_type = data.get("type")
            logger.info(f"📨 Received: {message_type}")
            
            # ===== PING (Keep Alive) =====
            if message_type == "ping":
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:
                    break
                continue
            
            # ===== START INTERVIEW =====
            if message_type == "start":
                token = data.get("token")
                mode = data.get("mode", "mode1")
                
                # Verify token
                username = verify_token(token)
                if not username:
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Invalid token"
                        })
                    except Exception as e:
                        logger.debug(f"Failed to send error: {e}")
                    continue
                
                # Create session
                session_id = f"session_{int(time.time())}_{username}"
                async with state_lock:
                    interview_sessions[session_id] = {
                        "id": session_id,
                        "username": username,
                        "mode": mode,
                        "start_time": datetime.now().isoformat(),
                        "transcripts": [],
                        "weak_points": []
                    }
                
                logger.info(f"✨ Interview started: {session_id} (mode: {mode})")
                
                try:
                    await websocket.send_json({
                        "type": "session_started",
                        "session_id": session_id,
                        "mode": mode
                    })
                except Exception as e:
                    logger.debug(f"Failed to send session_started: {e}")
            
            # ===== NEW TRANSCRIPT =====
            elif message_type == "transcript":
                if not session_id:
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "message": "No active session"
                        })
                    except Exception:
                        pass
                    continue
                
                payload = data.get("payload", {})
                speaker = payload.get("speaker", "").lower()
                text = payload.get("text", "")
                timestamp = payload.get("timestamp", time.time())
                
                if not text.strip() or speaker not in ["hr", "candidate"]:
                    continue
                
                # Store transcript
                async with state_lock:
                    if session_id in interview_sessions:
                        transcript_entry = {
                            "speaker": speaker,
                            "text": text,
                            "timestamp": timestamp
                        }
                        interview_sessions[session_id]["transcripts"].append(transcript_entry)
                
                logger.info(f"📝 {speaker.upper()}: {text[:50]}...")
                
                # Broadcast to all clients
                await broadcast_update({
                    "type": "new_transcript",
                    "session_id": session_id,
                    "payload": {
                        "speaker": speaker,
                        "text": text,
                        "timestamp": timestamp
                    }
                })
            
            # ===== ADD WEAK POINTS =====
            elif message_type == "weak_points":
                if not session_id:
                    continue
                
                weak_points = data.get("weak_points", [])
                
                async with state_lock:
                    if session_id in interview_sessions:
                        interview_sessions[session_id]["weak_points"].extend(weak_points)
                
                logger.info(f"💡 Added {len(weak_points)} weak points")
                
                await broadcast_update({
                    "type": "weak_points_updated",
                    "session_id": session_id,
                    "weak_points": weak_points
                })
            
            # ===== PAUSE INTERVIEW =====
            elif message_type == "pause":
                if session_id:
                    is_paused = True
                    logger.info(f"⏸️  Interview paused: {session_id}")
                    await websocket.send_json({
                        "type": "interview_paused",
                        "session_id": session_id
                    })
                continue
            
            # ===== RESUME INTERVIEW =====
            elif message_type == "resume":
                if session_id:
                    is_paused = False
                    logger.info(f"▶️  Interview resumed: {session_id}")
                    await websocket.send_json({
                        "type": "interview_resumed",
                        "session_id": session_id
                    })
                continue
            
            # ===== END INTERVIEW =====
            elif message_type == "end":
                if session_id:
                    async with state_lock:
                        if session_id in interview_sessions:
                            interview_sessions[session_id]["end_time"] = datetime.now().isoformat()
                            
                            # Save to JSON file
                            filename = f"interviews/{session_id}.json"
                            os.makedirs("interviews", exist_ok=True)
                            with open(filename, "w") as f:
                                json.dump(interview_sessions[session_id], f, indent=2)
                            
                            logger.info(f"💾 Interview saved: {filename}")
                    
                    await websocket.send_json({
                        "type": "session_ended",
                        "session_id": session_id
                    })
                    session_id = None
    
    except WebSocketDisconnect:
        logger.info("🔌 WebSocket disconnected")
        if session_id:
            async with state_lock:
                if session_id in interview_sessions:
                    interview_sessions[session_id]["end_time"] = datetime.now().isoformat()
                    # Save on disconnect
                    filename = f"interviews/{session_id}.json"
                    os.makedirs("interviews", exist_ok=True)
                    with open(filename, "w") as f:
                        json.dump(interview_sessions[session_id], f, indent=2)
    
    except Exception as e:
        logger.debug(f"WebSocket exception: {type(e).__name__}")
    
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)


"""Interview routes - REST API and WebSocket (V2-Lite: OpenAI Realtime Only)"""

import os
import json
import time
import logging
import base64
import asyncio
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from utils.auth import verify_token
# from utils.broadcast import broadcast_update # Not used in lite mode
from core.state import interview_sessions, active_websockets, state_lock
from services.openai_realtime import OpenAIRealtimeService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["interview"])

# ============ MODELS ============

class CreateInterviewRequest(BaseModel):
    candidate_name: str
    candidate_email: Optional[str] = None
    mode: str = "realtime"

# ============ REST API ENDPOINTS ============

@router.post("/api/interview/create")
async def create_interview(request: CreateInterviewRequest):
    """Create new interview session"""
    interview_id = f"interview_{int(time.time())}"
    
    async with state_lock:
        interview_sessions[interview_id] = {
            "id": interview_id,
            "candidate_name": request.candidate_name,
            "start_time": datetime.now().isoformat(),
            "status": "created",
            "transcripts": [],
            "suggested_questions": []
        }
    
    return {"interview_id": interview_id, "status": "created"}

# ============ WEBSOCKET ENDPOINT (REALTIME ONLY) ============

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time interview (V2-Lite)
    Connects frontend directly to OpenAI Realtime Service via backend proxy.
    """
    try:
        await websocket.accept()
        active_websockets.append(websocket)
        logger.info(f"✅ WebSocket accepted from {websocket.client}")
    except Exception as e:
        logger.error(f"❌ WebSocket accept failed: {e}")
        return

    session_id = None
    openai_service = None
    openai_task = None
    
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except Exception:
                break
            
            message_type = data.get("type")
            
            # ===== PING =====
            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            
            # ===== GENERATE QUESTIONS =====
            if message_type == "generate_questions":
                if openai_service:
                    await openai_service.send_text_instruction("Based on the conversation so far, please generate 3 follow-up questions immediately using the submit_interview_suggestions tool.")
                    await websocket.send_json({"type": "info", "message": "Generating questions..."})
                continue

            # ===== START INTERVIEW =====
            if message_type == "start":
                token = data.get("token")
                username = verify_token(token)
                
                if not username:
                    await websocket.send_json({"type": "error", "message": "Invalid token"})
                    continue
                
                session_id = f"session_{int(time.time())}_{username}"
                
                # Initialize Session State
                input_username = data.get("username")
                input_mode = data.get("mode", "realtime")
                
                # Use frontend username if provided, otherwise token username
                final_username = input_username if input_username else username
                
                async with state_lock:
                    interview_sessions[session_id] = {
                        "id": session_id,
                        "username": final_username,
                        "mode": input_mode,
                        "start_time": datetime.now().isoformat(),
                        "transcripts": [],
                        "suggested_questions": []
                    }
                
                logger.info(f"✨ Interview started: {session_id}")

                # Initialize OpenAI Realtime Service
                try:
                    openai_service = OpenAIRealtimeService()
                    await openai_service.connect()
                    logger.info("🚀 OpenAI Realtime Service Connected")
                    
                    # Background listener: OpenAI -> Frontend
                    async def listen_to_openai():
                        try:
                            # Iterate over events yielded by the service
                            async for event in openai_service.listen():
                                
                                # 1. TRANSCRIPT (Final)
                                if event["type"] == "transcript":
                                    text = event.get("text", "")
                                    timestamp = int(time.time() * 1000)
                                    
                                    # Send to Frontend
                                    await websocket.send_json({
                                        "type": "transcript_update",
                                        "session_id": session_id,
                                        "payload": {
                                            "speaker": "candidate",
                                            "text": text,
                                            "timestamp": timestamp,
                                            "is_final": True
                                        }
                                    })
                                    
                                    # Save to Session State
                                    async with state_lock:
                                        if session_id in interview_sessions:
                                            interview_sessions[session_id]["transcripts"].append({
                                                "speaker": "candidate",
                                                "text": text,
                                                "timestamp": timestamp
                                            })

                                # 2. SUGGESTED QUESTIONS (Function Call)
                                elif event["type"] == "analysis":
                                    payload = event.get("payload", {})
                                    questions_list = payload.get("suggestions", [])
                                    
                                    logger.info(f"💡 AI Generated {len(questions_list)} questions")
                                    
                                    # Format for frontend
                                    frontend_questions = []
                                    for i, q in enumerate(questions_list):
                                        frontend_questions.append({
                                            "id": f"q_{int(time.time())}_{i}",
                                            "text": q.get("question", ""),
                                            "skill": q.get("type", "general").upper().replace("_", " "),
                                            "reasoning": q.get("reasoning", ""),
                                            "timestamp": int(time.time() * 1000)
                                        })
                                    
                                    # Send to Frontend
                                    if frontend_questions:
                                        await websocket.send_json({
                                            "type": "suggested_questions",
                                            "session_id": session_id,
                                            "questions": frontend_questions
                                        })
                                    
                                    # Save to Session State
                                    async with state_lock:
                                        if session_id in interview_sessions:
                                            interview_sessions[session_id]["suggested_questions"].extend(frontend_questions)

                        except Exception as e:
                            logger.error(f"Error in OpenAI listener: {e}")
                    
                    # Start the listener task
                    openai_task = asyncio.create_task(listen_to_openai())
                    
                    # Notify frontend that session is ready
                    await websocket.send_json({
                        "type": "session_started",
                        "session_id": session_id,
                        "mode": "realtime"
                    })

                except Exception as e:
                    logger.error(f"Failed to start OpenAI Realtime: {e}")
                    await websocket.send_json({"type": "error", "message": "Failed to connect to AI Service"})
            
            # ===== AUDIO CHUNK =====
            elif message_type == "audio":
                # Only process if service is connected
                if openai_service:
                    payload = data.get("payload")
                    if payload:
                        try:
                            # It's base64 from frontend, convert to bytes -> send to service
                            # (Service will re-encode to base64 for JSON payload, 
                            # or handle raw bytes if using binary frame)
                            # Our Service expects bytes.
                            audio_bytes = base64.b64decode(payload)
                            await openai_service.send_audio_chunk(audio_bytes)
                        except Exception as e:
                            logger.error(f"Audio processing error: {e}")

            # ===== END INTERVIEW =====
            elif message_type == "end" or message_type == "stop":
                if session_id:
                    logger.info(f"🛑 Ending interview: {session_id}")
                    
                    # SAVE TO FILE
                    async with state_lock:
                        if session_id in interview_sessions:
                            # Update status
                            interview_sessions[session_id]["status"] = "completed"
                            interview_sessions[session_id]["end_time"] = datetime.now().isoformat()
                            
                            # Write JSON
                            try:
                                directory = "interviews"
                                if not os.path.exists(directory):
                                    os.makedirs(directory)
                                
                                filename = f"{directory}/{session_id}.json"
                                with open(filename, 'w', encoding='utf-8') as f:
                                    json.dump(interview_sessions[session_id], f, indent=2, ensure_ascii=False)
                                logger.info(f"💾 Saved interview data to {filename}")
                            except Exception as e:
                                logger.error(f"Failed to save JSON: {e}")

                    # Notify frontend
                    await websocket.send_json({"type": "session_ended"})
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)
        
        # Cleanup
        if openai_task:
            openai_task.cancel()
            try:
                await openai_task
            except asyncio.CancelledError:
                pass
        
        if openai_service:
            await openai_service.disconnect()

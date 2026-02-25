
"""Interview routes - REST API and WebSocket (V2: Dual OpenAI Realtime Connections)"""

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

# ============ WEBSOCKET ENDPOINT (DUAL REALTIME CONNECTIONS) ============

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time interview.
    Uses TWO OpenAI Realtime connections:
    - hr_service: For HR/interviewer audio (microphone)
    - candidate_service: For candidate audio (screen share)
    """
    try:
        await websocket.accept()
        active_websockets.append(websocket)
        logger.info(f"✅ WebSocket accepted from {websocket.client}")
    except Exception as e:
        logger.error(f"❌ WebSocket accept failed: {e}")
        return

    session_id = None
    hr_service = None
    candidate_service = None
    hr_task = None
    candidate_task = None
    
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
                # Send to candidate service (which has tools enabled)
                if candidate_service:
                    await candidate_service.send_text_instruction(
                        "Based on the conversation so far, please generate 3 follow-up questions immediately using the submit_interview_suggestions tool."
                    )
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

                # Initialize TWO OpenAI Realtime Services
                try:
                    # HR Service: transcribe only, no tools
                    hr_service = OpenAIRealtimeService(speaker="hr", enable_tools=False)
                    await hr_service.connect()
                    logger.info("🚀 HR OpenAI Realtime Service Connected")
                    
                    # Candidate Service: transcribe + generate questions
                    candidate_service = OpenAIRealtimeService(speaker="candidate", enable_tools=True)
                    await candidate_service.connect()
                    logger.info("🚀 Candidate OpenAI Realtime Service Connected")
                    
                    # Track speaking state for interim display
                    speaking_state = {"hr": None, "candidate": None}
                    
                    # Helper function to handle events from either service
                    async def handle_event(event, service_name):
                        nonlocal speaking_state
                        
                        # Handle speech_started - show "Speaking..." placeholder
                        if event["type"] == "speech_started":
                            speaker = event.get("speaker", "candidate")
                            timestamp = int(time.time() * 1000)
                            interim_id = f"speaking_{speaker}_{timestamp}"
                            speaking_state[speaker] = interim_id
                            
                            await websocket.send_json({
                                "type": "transcript_update",
                                "session_id": session_id,
                                "payload": {
                                    "speaker": speaker,
                                    "text": "...",  # Placeholder for "Speaking..."
                                    "timestamp": timestamp,
                                    "is_final": False,
                                    "id": interim_id
                                }
                            })
                            return
                        
                        if event["type"] == "transcript":
                            text = event.get("text", "")
                            speaker = event.get("speaker", "candidate")
                            timestamp = int(time.time() * 1000)
                            
                            # Check if we need to replace an interim "speaking" entry
                            interim_id = speaking_state.get(speaker)
                            if interim_id:
                                # Send update to replace the interim entry
                                await websocket.send_json({
                                    "type": "transcript_replace",
                                    "session_id": session_id,
                                    "payload": {
                                        "replace_id": interim_id,
                                        "speaker": speaker,
                                        "text": text,
                                        "timestamp": timestamp,
                                        "is_final": True
                                    }
                                })
                                speaking_state[speaker] = None
                            else:
                                # Send to Frontend (no interim to replace)
                                await websocket.send_json({
                                    "type": "transcript_update",
                                    "session_id": session_id,
                                    "payload": {
                                        "speaker": speaker,
                                        "text": text,
                                        "timestamp": timestamp,
                                        "is_final": True
                                    }
                                })
                            
                            # Save to Session State
                            async with state_lock:
                                if session_id in interview_sessions:
                                    interview_sessions[session_id]["transcripts"].append({
                                        "speaker": speaker,
                                        "text": text,
                                        "timestamp": timestamp
                                    })

                        elif event["type"] == "analysis":
                            payload = event.get("payload", {})
                            questions_list = payload.get("suggestions", [])
                            
                            logger.info(f"💡 AI Generated {len(questions_list)} questions")
                            
                            frontend_questions = []
                            for i, q in enumerate(questions_list):
                                frontend_questions.append({
                                    "id": f"q_{int(time.time())}_{i}",
                                    "text": q.get("question", ""),
                                    "skill": q.get("type", "general").upper().replace("_", " "),
                                    "reasoning": q.get("reasoning", ""),
                                    "timestamp": int(time.time() * 1000)
                                })
                            
                            if frontend_questions:
                                await websocket.send_json({
                                    "type": "suggested_questions",
                                    "session_id": session_id,
                                    "questions": frontend_questions
                                })
                            
                            async with state_lock:
                                if session_id in interview_sessions:
                                    interview_sessions[session_id]["suggested_questions"].extend(frontend_questions)
                    
                    # Background listener for HR service
                    async def listen_to_hr():
                        try:
                            async for event in hr_service.listen():
                                await handle_event(event, "HR")
                        except Exception as e:
                            logger.error(f"Error in HR listener: {e}")
                    
                    # Background listener for Candidate service
                    async def listen_to_candidate():
                        try:
                            async for event in candidate_service.listen():
                                await handle_event(event, "Candidate")
                        except Exception as e:
                            logger.error(f"Error in Candidate listener: {e}")
                    
                    # Start both listener tasks
                    hr_task = asyncio.create_task(listen_to_hr())
                    candidate_task = asyncio.create_task(listen_to_candidate())
                    
                    # Notify frontend that session is ready
                    await websocket.send_json({
                        "type": "session_started",
                        "session_id": session_id,
                        "mode": "realtime_dual"
                    })

                except Exception as e:
                    logger.error(f"Failed to start OpenAI Realtime: {e}")
                    await websocket.send_json({"type": "error", "message": f"Failed to connect to AI Service: {e}"})
            
            # ===== AUDIO CHUNK (HR - from microphone) =====
            elif message_type == "audio_hr":
                if hr_service:
                    payload = data.get("payload")
                    if payload:
                        try:
                            audio_bytes = base64.b64decode(payload)
                            await hr_service.send_audio_chunk(audio_bytes)
                        except Exception as e:
                            logger.error(f"HR audio processing error: {e}")

            # ===== AUDIO CHUNK (Candidate - from screen share) =====
            elif message_type == "audio_candidate":
                if candidate_service:
                    payload = data.get("payload")
                    if payload:
                        try:
                            audio_bytes = base64.b64decode(payload)
                            await candidate_service.send_audio_chunk(audio_bytes)
                        except Exception as e:
                            logger.error(f"Candidate audio processing error: {e}")

            # ===== END INTERVIEW =====
            elif message_type == "end" or message_type == "stop":
                if session_id:
                    logger.info(f"🛑 Ending interview: {session_id}")
                    
                    # SAVE TO FILE
                    async with state_lock:
                        if session_id in interview_sessions:
                            interview_sessions[session_id]["status"] = "completed"
                            interview_sessions[session_id]["end_time"] = datetime.now().isoformat()
                            
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

                    await websocket.send_json({"type": "session_ended"})
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)
        
        # Cleanup tasks
        for task in [hr_task, candidate_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        
        # Cleanup services
        for service in [hr_service, candidate_service]:
            if service:
                await service.disconnect()

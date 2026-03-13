
"""Interview routes - REST API and WebSocket (V2: Dual OpenAI Realtime Connections)"""

import os
import json
import time
import logging
import base64
import asyncio
from datetime import datetime, timezone, timedelta

# Hardcode Singapore Time (UTC+8)
SGT = timezone(timedelta(hours=8))
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
            "start_time": datetime.now(SGT).isoformat(),
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
            
            # ===== RECORD BUTTON CLICK =====
            if message_type == "record_button_click":
                # Record the click timestamp
                async with state_lock:
                    if session_id and session_id in interview_sessions:
                        if "button_clicks" not in interview_sessions[session_id]:
                            interview_sessions[session_id]["button_clicks"] = []
                        interview_sessions[session_id]["button_clicks"].append({
                            "timestamp": int(time.time() * 1000)
                        })
                
                # Unveil: send buffered questions to frontend
                if pending_questions:
                    await websocket.send_json({
                        "type": "suggested_questions",
                        "session_id": session_id,
                        "questions": pending_questions
                    })
                    logger.info(f"💡 Unveiled {len(pending_questions)} buffered questions")
                    
                    # Store only the unveiled questions so they appear in the JSON
                    async with state_lock:
                        if session_id in interview_sessions:
                            # Use current timestamp for JSON record to signify when HR actually saw them
                            for q in pending_questions:
                                q_copy = q.copy()
                                q_copy["timestamp"] = int(time.time() * 1000)
                                interview_sessions[session_id]["suggested_questions"].append(q_copy)
                    
                    pending_questions = []
                elif candidate_service:
                    # Buffer empty — wait for AI to finish processing the ongoing speech
                    # Flag so the next analysis result goes directly to frontend AND saves to json
                    send_next_directly = True
                    logger.info("💡 Buffer empty, forcing question generation on demand")
                    await candidate_service.send_text_instruction(
                        "The HR just clicked the button but the candidate is still speaking or just finished. Based on everything you've heard so far right up to this exact moment, please generate 3 follow-up questions immediately using the submit_interview_suggestions tool."
                    )
                continue
                
            # ===== GENERATE QUESTIONS (Fallback) =====
            if message_type == "generate_questions":
                if candidate_service:
                    await candidate_service.send_text_instruction(
                        "Based on the conversation so far, please generate 3 follow-up questions immediately using the submit_interview_suggestions tool."
                    )
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
                        "start_time": datetime.now(SGT).strftime("%Y-%m-%d %H:%M:%S"),
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
                    
                    # Buffer for AI-generated questions (unveiled on button click)
                    pending_questions = [
                        {
                            "id": f"q_init_1",
                            "text": "Could you walk me through a recent project you are particularly proud of?",
                            "type": "follow_up",
                            "skill": "🔽 FOLLOW-UP",
                            "timestamp": int(time.time() * 1000)
                        },
                        {
                            "id": f"q_init_2",
                            "text": "What do you consider your greatest professional strength in this role?",
                            "type": "move_on",
                            "skill": "➡️ MOVE-ON",
                            "timestamp": int(time.time() * 1000)
                        },
                        {
                            "id": f"q_init_3",
                            "text": "Can you share an example of a difficult challenge you successfully overcame?",
                            "type": "revert",
                            "skill": "🔙 REVERT",
                            "timestamp": int(time.time() * 1000)
                        }
                    ]
                    # Flag: if True, next generated questions go directly to frontend
                    send_next_directly = False
                    
                    # Track speaking state for interim display
                    # Store the current active placeholder ID per speaker
                    # speaking_state = {"hr": None, "candidate": None}
                    
                    # Helper function to handle events from either service
                    async def handle_event(event, service_name):
                        # nonlocal speaking_state
                        
                        # Handle speech_started - show "Speaking..." placeholder
                        if event["type"] == "speech_started":
                            """
                            speaker = event.get("speaker", "candidate")
                            timestamp = int(time.time() * 1000)
                            interim_id = f"speaking_{speaker}_{timestamp}"
                            
                            # If there's already a placeholder for this speaker,
                            # remove the old one first to avoid duplicates
                            old_id = speaking_state.get(speaker)
                            if old_id:
                                await websocket.send_json({
                                    "type": "transcript_remove",
                                    "session_id": session_id,
                                    "payload": {"id": old_id}
                                })
                            
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
                            """
                            return
                        
                        # Handle speech_stopped - clean up stale "Speaking..." if no transcript follows
                        if event["type"] == "speech_stopped":
                            """
                            speaker = event.get("speaker", "candidate")
                            stale_id = speaking_state.get(speaker)
                            if stale_id:
                                # Schedule cleanup after 3s if transcript hasn't replaced it
                                async def cleanup_stale(sid, spk):
                                    await asyncio.sleep(3)
                                    if speaking_state.get(spk) == sid:
                                        speaking_state[spk] = None
                                        await websocket.send_json({
                                            "type": "transcript_remove",
                                            "session_id": session_id,
                                            "payload": {"id": sid}
                                        })
                                asyncio.create_task(cleanup_stale(stale_id, speaker))
                            """
                            return
                        
                        if event["type"] == "transcript":
                            text = event.get("text", "")
                            speaker = event.get("speaker", "candidate")
                            timestamp = int(time.time() * 1000)
                            
                            """
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
                            """
                            
                            # Save to Session State
                            async with state_lock:
                                if session_id in interview_sessions:
                                    interview_sessions[session_id]["transcripts"].append({
                                        "speaker": speaker,
                                        "text": text,
                                        "timestamp": timestamp
                                    })
                                    
                            # Auto-trigger AI question generation if Candidate just finished speaking
                            if speaker == "candidate" and candidate_service:
                                await candidate_service.send_text_instruction(
                                    "The candidate just finished speaking. Based on the conversation so far, please generate 3 follow-up questions immediately using the submit_interview_suggestions tool."
                                )

                        elif event["type"] == "analysis":
                            payload = event.get("payload", {})
                            
                            TYPE_LABELS = {
                                "follow_up": "🔽 FOLLOW-UP",
                                "move_on": "➡️ MOVE-ON",
                                "revert": "🔙 REVERT",
                            }
                            
                            # Parse new schema: 3 separate fields instead of array
                            frontend_questions = []
                            for q_type in ["follow_up", "move_on", "revert"]:
                                q_data = payload.get(q_type)
                                if q_data and q_data.get("question"):
                                    frontend_questions.append({
                                        "id": f"q_{int(time.time())}_{q_type}",
                                        "text": q_data.get("question", ""),
                                        "type": q_type,
                                        "skill": TYPE_LABELS.get(q_type, q_type.upper()),
                                        "timestamp": int(time.time() * 1000)
                                    })
                            
                            logger.info(f"💡 AI Generated {len(frontend_questions)} questions")
                            
                            if frontend_questions:
                                nonlocal pending_questions, send_next_directly
                                if send_next_directly:
                                    # Force-triggered: send directly to frontend
                                    await websocket.send_json({
                                        "type": "suggested_questions",
                                        "session_id": session_id,
                                        "questions": frontend_questions
                                    })
                                    send_next_directly = False
                                    logger.info(f"💡 Sent {len(frontend_questions)} questions directly (on-demand)")
                                    
                                    # Store only the newly unveiled questions so they appear in JSON
                                    async with state_lock:
                                        if session_id in interview_sessions:
                                            # Update timestamps to when they were seen
                                            for q in frontend_questions:
                                                q_copy = q.copy()
                                                q_copy["timestamp"] = int(time.time() * 1000)
                                                interview_sessions[session_id]["suggested_questions"].append(q_copy)
                                else:
                                    # Background: buffer for later unveil (NOT saved to JSON yet)
                                    pending_questions = frontend_questions
                    
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
                            session_data = interview_sessions[session_id]
                            session_data["status"] = "completed"
                            session_data["end_time"] = datetime.now(SGT).strftime("%Y-%m-%d %H:%M:%S")
                            
                            timeline = []
                            for t in session_data.get("transcripts", []):
                                dt = datetime.fromtimestamp(t["timestamp"] / 1000.0, tz=SGT)
                                timeline.append({
                                    "event": "transcript",
                                    "speaker": t["speaker"],
                                    "text": t["text"],
                                    "time": dt.strftime("%Y-%m-%d %H:%M:%S"),
                                    "_ts": t["timestamp"]
                                })
                                
                            qs_by_ts = {}
                            for q in session_data.get("suggested_questions", []):
                                bucket = q["timestamp"] // 5000
                                if bucket not in qs_by_ts:
                                    qs_by_ts[bucket] = []
                                qs_by_ts[bucket].append(q)
                                
                            for bucket, qs in qs_by_ts.items():
                                avg_ts = qs[0]["timestamp"]
                                dt = datetime.fromtimestamp(avg_ts / 1000.0, tz=SGT)
                                formatted_qs = [{"type": q["type"], "question": q["text"]} for q in qs]
                                timeline.append({
                                    "event": "ai_questions",
                                    "questions": formatted_qs,
                                    "time": dt.strftime("%Y-%m-%d %H:%M:%S"),
                                    "_ts": avg_ts
                                })
                                
                            for bc in session_data.get("button_clicks", []):
                                dt = datetime.fromtimestamp(bc["timestamp"] / 1000.0, tz=SGT)
                                timeline.append({
                                    "event": "hr_clicked_button",
                                    "time": dt.strftime("%Y-%m-%d %H:%M:%S"),
                                    "_ts": bc["timestamp"]
                                })
                                
                            _EVT_ORDER = {"hr_clicked_button": 0, "transcript": 1, "ai_questions": 2}
                            timeline.sort(key=lambda x: (x["_ts"], _EVT_ORDER.get(x["event"], 1)))
                            for item in timeline:
                                item.pop("_ts", None)
                                
                            save_data = {
                                "id": session_data["id"],
                                "username": session_data["username"],
                                "mode": session_data.get("mode", "realtime"),
                                "start_time": session_data.get("start_time"),
                                "end_time": session_data["end_time"],
                                "status": session_data["status"],
                                "total_ai_helping_times": len(session_data.get("button_clicks", [])),
                                "timeline": timeline
                            }
                            
                            try:
                                directory = "interviews"
                                if not os.path.exists(directory):
                                    os.makedirs(directory)
                                
                                filename = f"{directory}/{session_id}.json"
                                with open(filename, 'w', encoding='utf-8') as f:
                                    json.dump(save_data, f, indent=2, ensure_ascii=False)
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

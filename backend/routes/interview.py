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
from services.realtime_analyzer import RealtimeAnalyzer
from collections import defaultdict

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
            "weak_points": [],

            "utterance_buffer":{
                "current_speaker": None,
                "current_text": "",
                "current_start_timestamp": None,
                "last_activity_time": time
            }
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
            filename = f"../interviews/{interview_id}.json"
            os.makedirs("../interviews", exist_ok=True)
            with open(filename, "w") as f:
                json.dump(interview_sessions[interview_id], f, indent=2)
            
            logger.info(f"💾 Interview saved: {filename}")
            
            return {"message": "Interview saved successfully"}
    
    return {"error": "Interview not found"}

# ============ HELPER FUNCTIONS ============

async def commit_buffer(session_id: str, session: dict, buffer: dict):
    """Commit the current utterance buffer to transcripts and trigger analysis"""
    if not buffer["current_text"]:
        return

    full_text = buffer["current_text"].strip()
    entry = {
        "speaker": buffer["current_speaker"],
        "text": full_text,
        "timestamp": buffer["current_start_timestamp"],
        "time": datetime.fromtimestamp(buffer["current_start_timestamp"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
    }

    # 存入 transcripts
    session["transcripts"].append(entry)

    logger.info(f"📝 COMMIT {buffer['current_speaker'].upper()}: {full_text[:50]}...")

    # 推送完整 utterance 给前端（不再碎）
    await broadcast_update({
        "type": "new_transcript",
        "session_id": session_id,
        "payload": entry
    })

    # 根据 speaker 自动分析（现在 text 是完整的）
    analyzer = RealtimeAnalyzer()

    if buffer["current_speaker"] == "hr":
        classification = await analyzer.classify_question(full_text)
        logger.info(f"🎯 HR Question: {classification.get('question_type')}")
        session["last_hr_question"] = full_text
        session["last_classification"] = classification

    elif buffer["current_speaker"] == "candidate":
        last_q = session.get("last_hr_question")
        if last_q:
            analysis = await analyzer.analyze_answer(last_q, full_text, "star")
            logger.info(f"📊 Answer score: {analysis.get('quality_score')}")
            session["last_candidate_answer"] = full_text
            session["last_analysis"] = analysis
            # 可选：自动加到 weak_points 或触发 suggested_questions

    # 清空 buffer
    buffer["current_speaker"] = None
    buffer["current_text"] = ""
    buffer["current_start_timestamp"] = None

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
                        "weak_points": [],
                        "utterance_buffer": {
                            "current_speaker": None,
                            "current_text": "",
                            "current_start_timestamp": None,
                            "last_activity_time": time.time()
                        }
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
                    await websocket.send_json({"type": "error", "message": "No active session"})
                    continue

                payload = data.get("payload", {})
                speaker = payload.get("speaker", "").lower()
                text = payload.get("text", "").strip()
                timestamp = payload.get("timestamp", time.time())

                if not text or speaker not in ["hr", "candidate"]:
                    continue

                # ✅ 不在这里广播，让buffer处理后再广播，避免重复

                async with state_lock:
                    session = interview_sessions[session_id]
                    buffer = session["utterance_buffer"]

                    current_time = time.time()

                    # 如果之前commit过，就不要重复commit
                    if buffer["current_speaker"] is None:
                        # Buffer已经清空，这是新的一个block
                        buffer["current_speaker"] = speaker
                        buffer["current_text"] = text
                        buffer["current_start_timestamp"] = timestamp
                    elif speaker != buffer["current_speaker"]:
                        # speaker 切换 → 先 commit 上一个
                        if buffer["current_text"]:
                            await commit_buffer(session_id, session, buffer)
                        # 重置 buffer for new speaker
                        buffer["current_speaker"] = speaker
                        buffer["current_text"] = text
                        buffer["current_start_timestamp"] = timestamp
                    else:
                        # 同 speaker → 累积
                        buffer["current_text"] += " " + text

                    buffer["last_activity_time"] = current_time

            # ===== MANUAL AI ANALYSIS REQUEST =====
            elif message_type == "request_analysis":
                if not session_id:
                    continue
                
                logger.info("🤖 Manual AI analysis requested")
                
                try:
                    # ✅ First, commit any pending buffer content before analysis
                    async with state_lock:
                        if session_id in interview_sessions:
                            session = interview_sessions[session_id]
                            buffer = session["utterance_buffer"]
                            if buffer["current_text"]:
                                await commit_buffer(session_id, session, buffer)
                                logger.info("📝 Committed buffer before analysis")
                    
                    # Get cached results (now up-to-date after commit)
                    last_hr_question = None
                    last_candidate_answer = None
                    last_classification = None
                    last_analysis = None
                    
                    async with state_lock:
                        if session_id in interview_sessions:
                            session = interview_sessions[session_id]
                            last_hr_question = session.get("last_hr_question")
                            last_candidate_answer = session.get("last_candidate_answer")
                            last_classification = session.get("last_classification")
                            last_analysis = session.get("last_analysis")
                    
                    # Send cached classification if exists
                    if last_classification:
                        await websocket.send_json({
                            "type": "hr_question_classified",
                            "session_id": session_id,
                            "classification": last_classification
                        })
                        logger.info(f"🎯 Sent cached classification: {last_classification.get('question_type')}")
                    
                    # Send cached weak points if exists
                    if last_analysis:
                        weak_points = last_analysis.get("weak_points", [])
                        if weak_points:
                            async with state_lock:
                                if session_id in interview_sessions:
                                    interview_sessions[session_id]["weak_points"].extend(weak_points)
                            
                            await websocket.send_json({
                                "type": "weak_points_updated",
                                "session_id": session_id,
                                "weak_points": weak_points
                            })
                            logger.info(f"📊 Sent cached analysis, score: {last_analysis.get('quality_score')}")
                    
                    # Generate follow-up questions (only OpenAI call needed)
                    if last_hr_question and last_candidate_answer:
                        analyzer = RealtimeAnalyzer()
                        weak_area = "the answer"
                        if last_analysis:
                            weak_points = last_analysis.get("weak_points", [])
                            if weak_points:
                                weak_area = weak_points[0].get("component", "the topic")
                        
                        followups = await analyzer.generate_followup_questions(
                            f"Q: {last_hr_question}\nA: {last_candidate_answer}",
                            weak_area,
                            3
                        )
                        logger.info(f"💡 Generated {len(followups)} follow-up questions")
                        
                        # ✅ 记录AI生成到session中（包含时间）
                        async with state_lock:
                            if session_id in interview_sessions:
                                if "ai_generations" not in interview_sessions[session_id]:
                                    interview_sessions[session_id]["ai_generations"] = []
                                
                                interview_sessions[session_id]["ai_generations"].append({
                                    "timestamp": int(time.time() * 1000),
                                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),  # ✅ 可读时间
                                    "hr_question": last_hr_question,
                                    "candidate_answer": last_candidate_answer,
                                    "classification": last_classification,
                                    "analysis": last_analysis,
                                    "generated_questions": followups
                                })
                        
                        await websocket.send_json({
                            "type": "suggested_questions",
                            "session_id": session_id,
                            "questions": followups
                        })
                    else:
                        logger.warning("⚠️ No HR question or candidate answer to analyze")
                        await websocket.send_json({
                            "type": "analysis_error",
                            "message": "No conversation to analyze yet"
                        })
                    
                    # Send analysis complete notification
                    await websocket.send_json({
                        "type": "analysis_complete",
                        "session_id": session_id
                    })
                    
                except Exception as e:
                    logger.error(f"❌ OpenAI analysis error: {e}")
                    await websocket.send_json({
                        "type": "analysis_error",
                        "message": str(e)
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
                            filename = f"../interviews/{session_id}.json"
                            os.makedirs("../interviews", exist_ok=True)
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
                    filename = f"../interviews/{session_id}.json"
                    os.makedirs("../interviews", exist_ok=True)
                    with open(filename, "w") as f:
                        json.dump(interview_sessions[session_id], f, indent=2)
    
    except Exception as e:
        logger.debug(f"WebSocket exception: {type(e).__name__}")
    
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)

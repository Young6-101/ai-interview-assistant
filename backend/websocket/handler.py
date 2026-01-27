from fastapi import WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
import json
import logging
from datetime import datetime
import asyncio

from config.settings import settings
from database.db import get_db, SessionLocal
from models.interview import Interview
from models.user import User
from utils.security import decode_token

logger = logging.getLogger(__name__)

class WebSocketHandler:
    """
    Handle WebSocket connections for real-time interview processing.
    Manages screen sharing, transcription, and AI analysis.
    """
    
    def __init__(self):
        self.active_connections: dict = {}  # {user_id: websocket}
        self.interview_data: dict = {}  # {user_id: interview_data}
    
    async def connect(
        self,
        websocket: WebSocket,
        user_id: str,
        interview_id: str
    ):
        """
        Accept WebSocket connection and setup interview session.
        
        Args:
            websocket: WebSocket connection
            user_id: User ID from JWT token
            interview_id: Interview ID for this session
        """
        await websocket.accept()
        self.active_connections[user_id] = websocket
        
        # Initialize interview data
        self.interview_data[user_id] = {
            "interview_id": interview_id,
            "transcript": {},
            "weak_points": [],
            "questions_asked": [],
            "suggested_questions": [],
            "start_time": datetime.utcnow(),
            "status": "active"
        }
        
        logger.info(f"WebSocket connected: user={user_id}, interview={interview_id}")
        
        # Send connection confirmation
        await websocket.send_json({
            "type": "connection",
            "status": "connected",
            "message": "WebSocket connection established",
            "interview_id": interview_id
        })
    
    def disconnect(self, user_id: str):
        """
        Close WebSocket connection.
        
        Args:
            user_id: User ID
        """
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        
        if user_id in self.interview_data:
            del self.interview_data[user_id]
        
        logger.info(f"WebSocket disconnected: user={user_id}")
    
    async def send_personal(
        self,
        user_id: str,
        data: dict
    ):
        """
        Send message to specific user.
        
        Args:
            user_id: User ID
            data: Data to send
        """
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(data)
            except Exception as e:
                logger.error(f"Failed to send message to {user_id}: {str(e)}")
    
    async def handle_transcript(
        self,
        user_id: str,
        speaker: str,
        text: str
    ):
        """
        Handle incoming transcript data.
        
        Args:
            user_id: User ID
            speaker: Speaker identifier ("hr" or "candidate")
            text: Transcript text
        """
        if user_id not in self.interview_data:
            return
        
        # Store transcript
        key = f"{speaker}_{datetime.utcnow().timestamp()}"
        self.interview_data[user_id]["transcript"][key] = {
            "speaker": speaker,
            "text": text,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        logger.debug(f"Transcript received: user={user_id}, speaker={speaker}, text_len={len(text)}")
        
        # Send acknowledgement
        await self.send_personal(user_id, {
            "type": "transcript_ack",
            "status": "received",
            "speaker": speaker
        })
    
    async def handle_weak_points(
        self,
        user_id: str,
        weak_points: list
    ):
        """
        Handle weak points analysis from AI.
        
        Args:
            user_id: User ID
            weak_points: List of weak points identified
        """
        if user_id not in self.interview_data:
            return
        
        self.interview_data[user_id]["weak_points"] = weak_points
        
        logger.info(f"Weak points identified: user={user_id}, count={len(weak_points)}")
        
        # Send to frontend
        await self.send_personal(user_id, {
            "type": "weak_points",
            "data": weak_points
        })
    
    async def handle_suggested_questions(
        self,
        user_id: str,
        questions: list
    ):
        """
        Handle AI-suggested follow-up questions.
        
        Args:
            user_id: User ID
            questions: List of suggested questions
        """
        if user_id not in self.interview_data:
            return
        
        self.interview_data[user_id]["suggested_questions"] = questions
        
        logger.info(f"Suggested questions: user={user_id}, count={len(questions)}")
        
        # Send to frontend
        await self.send_personal(user_id, {
            "type": "suggested_questions",
            "data": questions
        })
    
    async def handle_question_asked(
        self,
        user_id: str,
        question: str
    ):
        """
        Record question asked during interview.
        
        Args:
            user_id: User ID
            question: Question text
        """
        if user_id not in self.interview_data:
            return
        
        self.interview_data[user_id]["questions_asked"].append(question)
        
        logger.debug(f"Question asked: user={user_id}")
    
    async def save_interview_to_db(
        self,
        user_id: str,
        db: Optional[Session] = None
    ):
        """
        Save interview data to database.
        
        Args:
            user_id: User ID
            db: Database session
        """
        if user_id not in self.interview_data:
            return None
        
        data = self.interview_data[user_id]
        
        try:
            if db is None:
                db = SessionLocal()
            
            # Get interview
            interview = db.query(Interview).filter(
                Interview.id == data["interview_id"]
            ).first()
            
            if not interview:
                logger.error(f"Interview not found: {data['interview_id']}")
                return None
            
            # Update interview with data
            interview.transcript = data["transcript"]
            interview.weak_points = data["weak_points"]
            interview.questions_asked = data["questions_asked"]
            interview.suggested_questions = data["suggested_questions"]
            interview.end_time = datetime.utcnow()
            interview.calculate_duration()
            
            db.add(interview)
            db.commit()
            db.refresh(interview)
            
            logger.info(f"Interview saved to database: {interview.id}")
            
            return interview.id
        
        except Exception as e:
            logger.error(f"Failed to save interview: {str(e)}")
            db.rollback()
            return None
    
    def get_interview_data(self, user_id: str) -> dict:
        """
        Get current interview data for user.
        
        Args:
            user_id: User ID
            
        Returns:
            Interview data dictionary
        """
        return self.interview_data.get(user_id, {})

# Global handler instance
ws_handler = WebSocketHandler()
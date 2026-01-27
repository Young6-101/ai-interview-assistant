from sqlalchemy.orm import Session
from models.interview import Interview
from models.user import User
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class InterviewService:
    """
    Business logic for interview operations.
    Handles data processing and analysis.
    """
    
    @staticmethod
    def create_interview(
        db: Session,
        user_id: str,
        candidate_name: str,
        candidate_email: str = None,
        mode: str = "mode1"
    ) -> Interview:
        """
        Create a new interview record.
        
        Args:
            db: Database session
            user_id: HR user ID
            candidate_name: Candidate name
            candidate_email: Candidate email (optional)
            mode: Interview mode (mode1, mode2, or mode3)
            
        Returns:
            Created Interview object
        """
        try:
            interview = Interview(
                user_id=user_id,
                candidate_name=candidate_name,
                candidate_email=candidate_email,
                mode=mode
            )
            
            db.add(interview)
            db.commit()
            db.refresh(interview)
            
            logger.info(f"Interview created: {interview.id} for candidate {candidate_name}")
            
            return interview
        
        except Exception as e:
            logger.error(f"Failed to create interview: {str(e)}")
            db.rollback()
            raise
    
    @staticmethod
    def update_interview(
        db: Session,
        interview_id: str,
        transcript: dict = None,
        weak_points: list = None,
        questions_asked: list = None,
        suggested_questions: list = None
    ) -> Interview:
        """
        Update interview with new data.
        
        Args:
            db: Database session
            interview_id: Interview ID
            transcript: Updated transcript
            weak_points: Updated weak points
            questions_asked: Updated questions asked
            suggested_questions: Updated suggested questions
            
        Returns:
            Updated Interview object
        """
        try:
            interview = db.query(Interview).filter(
                Interview.id == interview_id
            ).first()
            
            if not interview:
                logger.error(f"Interview not found: {interview_id}")
                return None
            
            if transcript is not None:
                interview.transcript = transcript
            if weak_points is not None:
                interview.weak_points = weak_points
            if questions_asked is not None:
                interview.questions_asked = questions_asked
            if suggested_questions is not None:
                interview.suggested_questions = suggested_questions
            
            db.add(interview)
            db.commit()
            db.refresh(interview)
            
            logger.info(f"Interview updated: {interview_id}")
            
            return interview
        
        except Exception as e:
            logger.error(f"Failed to update interview: {str(e)}")
            db.rollback()
            raise
    
    @staticmethod
    def analyze_weak_points(transcript: dict) -> list:
        """
        Analyze interview transcript and identify weak points.
        This is a placeholder for AI analysis integration.
        
        Args:
            transcript: Interview transcript
            
        Returns:
            List of identified weak points
        """
        # TODO: Integrate with OpenAI API for actual analysis
        weak_points = []
        
        for key, item in transcript.items():
            speaker = item.get("speaker", "")
            text = item.get("text", "")
            
            # Placeholder logic - replace with actual AI analysis
            if speaker == "candidate" and len(text) < 50:
                weak_points.append({
                    "question": "Previous question",
                    "analysis": "Answer was too brief",
                    "skill": "Communication"
                })
        
        return weak_points
    
    @staticmethod
    def generate_suggested_questions(
        transcript: dict,
        weak_points: list
    ) -> list:
        """
        Generate AI-suggested follow-up questions based on weak points.
        This is a placeholder for AI generation integration.
        
        Args:
            transcript: Interview transcript
            weak_points: Identified weak points
            
        Returns:
            List of suggested follow-up questions
        """
        # TODO: Integrate with OpenAI API for actual generation
        suggested = []
        
        if weak_points:
            for weak_point in weak_points:
                suggested.append({
                    "question": f"Can you elaborate on {weak_point.get('skill', 'this topic')}?",
                    "skill": weak_point.get("skill", "General"),
                    "type": "follow_up"
                })
        
        return suggested
    
    @staticmethod
    def calculate_interview_score(weak_points: list) -> float:
        """
        Calculate overall interview score based on weak points.
        Score from 0-100.
        
        Args:
            weak_points: List of weak points
            
        Returns:
            Interview score (0-100)
        """
        # Placeholder scoring logic
        base_score = 100
        penalty_per_weak_point = 15
        
        score = max(0, base_score - (len(weak_points) * penalty_per_weak_point))
        
        return score
    
    @staticmethod
    def format_interview_summary(interview: Interview) -> dict:
        """
        Format interview data for summary display.
        
        Args:
            interview: Interview object
            
        Returns:
            Formatted interview summary
        """
        return {
            "id": interview.id,
            "candidate": interview.candidate_name,
            "email": interview.candidate_email,
            "mode": interview.mode,
            "status": interview.status,
            "duration_minutes": interview.duration // 60 if interview.duration else 0,
            "questions_asked": len(interview.questions_asked),
            "weak_points_count": len(interview.weak_points),
            "start_time": interview.start_time.isoformat() if interview.start_time else None,
            "end_time": interview.end_time.isoformat() if interview.end_time else None,
            "score": InterviewService.calculate_interview_score(interview.weak_points)
        }
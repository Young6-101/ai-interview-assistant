from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from database.db import get_db
from models.user import User
from models.interview import Interview, InterviewStatus, InterviewMode
from utils.security import get_current_user
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview", tags=["interview"])

# ============ Request/Response Models ============

class TranscriptItem(BaseModel):
    """Single transcript item"""
    speaker: str  # "hr", "candidate", "system"
    text: str
    timestamp: Optional[float] = None

class WeakPoint(BaseModel):
    """Weak point identified during interview"""
    question: str
    analysis: str
    skill: str

class SuggestedQuestion(BaseModel):
    """AI-suggested follow-up question"""
    question: str
    skill: str
    type: str  # "follow_up", "skill_based"

class InterviewSaveRequest(BaseModel):
    """Request to save interview data"""
    candidate_name: str
    candidate_email: Optional[str] = None
    mode: str  # "mode1", "mode2", "mode3"
    transcript: dict  # {speaker: text}
    weak_points: List[dict] = []
    questions_asked: List[str] = []
    suggested_questions: List[dict] = []
    
    class Config:
        json_schema_extra = {
            "example": {
                "candidate_name": "John Doe",
                "candidate_email": "john@example.com",
                "mode": "mode1",
                "transcript": {
                    "hr": "Tell me about yourself",
                    "candidate": "I am a software engineer..."
                },
                "weak_points": [
                    {
                        "question": "What is your weakness?",
                        "analysis": "Candidate avoided the question",
                        "skill": "Honesty"
                    }
                ],
                "questions_asked": ["Tell me about yourself"],
                "suggested_questions": []
            }
        }

class InterviewResponse(BaseModel):
    """Interview response model"""
    id: str
    candidate_name: str
    candidate_email: Optional[str]
    mode: str
    status: str
    start_time: datetime
    end_time: Optional[datetime]
    duration: Optional[int]
    transcript: dict
    weak_points: list
    questions_asked: list
    
    class Config:
        from_attributes = True

class InterviewListResponse(BaseModel):
    """Interview list item response"""
    id: str
    candidate_name: str
    mode: str
    status: str
    start_time: datetime
    end_time: Optional[datetime]
    duration: Optional[int]
    
    class Config:
        from_attributes = True

# ============ Save Interview ============

@router.post("/save", response_model=dict, status_code=status.HTTP_201_CREATED)
async def save_interview(
    request: InterviewSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Save completed interview to database.
    
    Args:
        request: Interview data to save
        current_user: Current authenticated user (HR)
        db: Database session
        
    Returns:
        Dictionary with success message and interview ID
        
    Raises:
        HTTPException 400: Invalid request data
        HTTPException 500: Failed to save interview
    """
    try:
        # Create interview record
        interview = Interview(
            user_id=current_user.id,
            candidate_name=request.candidate_name,
            candidate_email=request.candidate_email,
            mode=request.mode,
            transcript=request.transcript,
            weak_points=request.weak_points,
            questions_asked=request.questions_asked,
            suggested_questions=request.suggested_questions,
            status=InterviewStatus.COMPLETED,
            end_time=datetime.utcnow()
        )
        
        # Calculate duration
        interview.calculate_duration()
        
        # Save to database
        db.add(interview)
        db.commit()
        db.refresh(interview)
        
        logger.info(f"Interview saved: {interview.id} by user {current_user.id}")
        
        return {
            "status": "saved",
            "interview_id": interview.id,
            "message": f"Interview for {request.candidate_name} saved successfully"
        }
    
    except Exception as e:
        logger.error(f"Failed to save interview: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save interview"
        )

# ============ Get Interview List ============

@router.get("/list", response_model=List[InterviewListResponse])
async def list_interviews(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 50
):
    """
    Get all interviews for current user.
    
    Args:
        current_user: Current authenticated user
        db: Database session
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return
        
    Returns:
        List of interviews for the user
    """
    try:
        interviews = db.query(Interview).filter(
            Interview.user_id == current_user.id
        ).order_by(
            Interview.created_at.desc()
        ).offset(skip).limit(limit).all()
        
        return interviews
    
    except Exception as e:
        logger.error(f"Failed to fetch interviews: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch interviews"
        )

# ============ Get Interview Details ============

@router.get("/{interview_id}", response_model=InterviewResponse)
async def get_interview(
    interview_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get detailed information about a specific interview.
    
    Args:
        interview_id: Interview ID to retrieve
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Complete interview data
        
    Raises:
        HTTPException 404: Interview not found
        HTTPException 403: User doesn't have access to this interview
    """
    try:
        interview = db.query(Interview).filter(
            Interview.id == interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            logger.warning(f"Interview not found: {interview_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        return interview
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch interview: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch interview"
        )

# ============ Delete Interview ============

@router.delete("/{interview_id}", status_code=status.HTTP_200_OK)
async def delete_interview(
    interview_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete an interview record.
    
    Args:
        interview_id: Interview ID to delete
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Dictionary with success message
        
    Raises:
        HTTPException 404: Interview not found
        HTTPException 403: User doesn't have access to delete
    """
    try:
        interview = db.query(Interview).filter(
            Interview.id == interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            logger.warning(f"Interview not found for deletion: {interview_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        db.delete(interview)
        db.commit()
        
        logger.info(f"Interview deleted: {interview_id}")
        
        return {
            "status": "deleted",
            "message": f"Interview {interview_id} deleted successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete interview: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete interview"
        )

# ============ Update Interview Status ============

@router.patch("/{interview_id}/status")
async def update_interview_status(
    interview_id: str,
    status: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update interview status.
    
    Args:
        interview_id: Interview ID to update
        status: New status ("ongoing", "completed", "cancelled")
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Updated interview
        
    Raises:
        HTTPException 400: Invalid status
        HTTPException 404: Interview not found
    """
    try:
        # Validate status
        valid_statuses = [s.value for s in InterviewStatus]
        if status not in valid_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {valid_statuses}"
            )
        
        interview = db.query(Interview).filter(
            Interview.id == interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        interview.status = status
        if status == InterviewStatus.COMPLETED:
            interview.end_time = datetime.utcnow()
            interview.calculate_duration()
        
        db.add(interview)
        db.commit()
        db.refresh(interview)
        
        logger.info(f"Interview status updated: {interview_id} -> {status}")
        
        return interview
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update interview status: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update interview status"
        )
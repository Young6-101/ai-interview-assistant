from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database.db import get_db
from models.interview import Interview
from models.survey import Survey
from utils.security import get_current_user
from models.user import User
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/survey", tags=["survey"])

# ============ Request/Response Models ============

class SurveySubmitRequest(BaseModel):
    """Survey submission request"""
    interview_id: str
    responses: dict  # {question: answer}
    rating: str  # "1-5", "A-F", etc.
    feedback: str
    strengths: Optional[list] = []
    improvements: Optional[list] = []
    recommendation: Optional[str] = None  # "hire", "maybe", "reject"
    link: Optional[str] = ""  # External link (recording, etc.)
    
    class Config:
        json_schema_extra = {
            "example": {
                "interview_id": "550e8400-e29b-41d4-a716-446655440000",
                "responses": {
                    "Q1": "Very knowledgeable",
                    "Q2": "Good communication skills"
                },
                "rating": "4",
                "feedback": "Strong candidate, good technical skills",
                "strengths": ["Technical Knowledge", "Communication"],
                "improvements": ["System Design"],
                "recommendation": "hire",
                "link": "https://recording-link.com"
            }
        }

class SurveyResponse(BaseModel):
    """Survey response model"""
    id: str
    interview_id: str
    responses: dict
    rating: str
    feedback: str
    strengths: list
    improvements: list
    recommendation: Optional[str]
    link: Optional[str]
    created_at: str
    
    class Config:
        from_attributes = True

# ============ Submit Survey ============

@router.post("/submit", response_model=dict, status_code=status.HTTP_201_CREATED)
async def submit_survey(
    request: SurveySubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Submit survey feedback for an interview.
    
    Args:
        request: Survey data
        current_user: Current authenticated user (HR)
        db: Database session
        
    Returns:
        Dictionary with success message and survey ID
        
    Raises:
        HTTPException 404: Interview not found
        HTTPException 400: Survey already submitted for this interview
        HTTPException 500: Failed to save survey
    """
    try:
        # Verify interview exists and belongs to current user
        interview = db.query(Interview).filter(
            Interview.id == request.interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            logger.warning(f"Interview not found for survey: {request.interview_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        # Check if survey already exists
        existing_survey = db.query(Survey).filter(
            Survey.interview_id == request.interview_id
        ).first()
        
        if existing_survey:
            logger.warning(f"Survey already submitted for interview: {request.interview_id}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Survey already submitted for this interview"
            )
        
        # Create survey record
        survey = Survey(
            interview_id=request.interview_id,
            responses=request.responses,
            rating=request.rating,
            feedback=request.feedback,
            strengths=request.strengths or [],
            improvements=request.improvements or [],
            recommendation=request.recommendation,
            link=request.link or ""
        )
        
        # Save to database
        db.add(survey)
        db.commit()
        db.refresh(survey)
        
        logger.info(f"Survey submitted: {survey.id} for interview {request.interview_id}")
        
        return {
            "status": "submitted",
            "survey_id": survey.id,
            "message": "Survey submitted successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to submit survey: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit survey"
        )

# ============ Get Survey ============

@router.get("/{interview_id}", response_model=SurveyResponse)
async def get_survey(
    interview_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get survey for a specific interview.
    
    Args:
        interview_id: Interview ID
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Survey data
        
    Raises:
        HTTPException 404: Survey not found or interview doesn't belong to user
    """
    try:
        # Verify interview belongs to current user
        interview = db.query(Interview).filter(
            Interview.id == interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        # Get survey
        survey = db.query(Survey).filter(
            Survey.interview_id == interview_id
        ).first()
        
        if not survey:
            logger.warning(f"Survey not found for interview: {interview_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Survey not found"
            )
        
        return survey
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch survey: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch survey"
        )

# ============ Update Survey ============

@router.put("/{interview_id}", response_model=SurveyResponse)
async def update_survey(
    interview_id: str,
    request: SurveySubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update existing survey.
    
    Args:
        interview_id: Interview ID
        request: Updated survey data
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Updated survey
        
    Raises:
        HTTPException 404: Survey not found
    """
    try:
        # Verify interview belongs to current user
        interview = db.query(Interview).filter(
            Interview.id == interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        # Get survey
        survey = db.query(Survey).filter(
            Survey.interview_id == interview_id
        ).first()
        
        if not survey:
            logger.warning(f"Survey not found for update: {interview_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Survey not found"
            )
        
        # Update fields
        survey.responses = request.responses
        survey.rating = request.rating
        survey.feedback = request.feedback
        survey.strengths = request.strengths or []
        survey.improvements = request.improvements or []
        survey.recommendation = request.recommendation
        survey.link = request.link or ""
        
        db.add(survey)
        db.commit()
        db.refresh(survey)
        
        logger.info(f"Survey updated: {survey.id}")
        
        return survey
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update survey: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update survey"
        )

# ============ Delete Survey ============

@router.delete("/{interview_id}", status_code=status.HTTP_200_OK)
async def delete_survey(
    interview_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete survey for an interview.
    
    Args:
        interview_id: Interview ID
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Success message
        
    Raises:
        HTTPException 404: Survey not found
    """
    try:
        # Verify interview belongs to current user
        interview = db.query(Interview).filter(
            Interview.id == interview_id,
            Interview.user_id == current_user.id
        ).first()
        
        if not interview:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interview not found"
            )
        
        # Get and delete survey
        survey = db.query(Survey).filter(
            Survey.interview_id == interview_id
        ).first()
        
        if not survey:
            logger.warning(f"Survey not found for deletion: {interview_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Survey not found"
            )
        
        db.delete(survey)
        db.commit()
        
        logger.info(f"Survey deleted: {survey.id}")
        
        return {
            "status": "deleted",
            "message": "Survey deleted successfully"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete survey: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete survey"
        )
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey, Text
from sqlalchemy.orm import relationship
from database.db import Base
from datetime import datetime
import uuid

class Survey(Base):
    """
    Survey model for storing post-interview feedback and survey responses.
    Linked to a specific interview session.
    """
    __tablename__ = "surveys"
    
    # Primary key
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    """Unique survey ID (UUID)"""
    
    # Foreign key
    interview_id = Column(String, ForeignKey("interviews.id"), nullable=False, unique=True, index=True)
    """Reference to the interview session (one-to-one relationship)"""
    
    # Survey responses
    responses = Column(JSON, default=dict)
    """
    Survey question responses.
    Format: {
        "question_1": "answer_1",
        "question_2": "answer_2",
        ...
    }
    """
    
    rating = Column(String(10), nullable=True)
    """
    Overall rating from the interviewer.
    Can be numeric (1-5, 1-10) or letter grade (A-F)
    """
    
    feedback = Column(Text, nullable=True)
    """
    Detailed feedback about the candidate's performance.
    Freeform text field for interviewer comments.
    """
    
    link = Column(String(500), nullable=True)
    """
    External link (e.g., recording URL, candidate profile, etc.)
    """
    
    strengths = Column(JSON, default=list)
    """
    List of candidate's strengths identified during interview.
    Format: ["Strength 1", "Strength 2", ...]
    """
    
    improvements = Column(JSON, default=list)
    """
    List of areas for improvement identified during interview.
    Format: ["Area 1", "Area 2", ...]
    """
    
    recommendation = Column(String(20), nullable=True)
    """
    Hiring recommendation: "hire", "maybe", "reject"
    """
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    """Survey submission timestamp"""
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    """Survey last update timestamp"""
    
    # Relationship
    interview = relationship("Interview", backref="survey", uselist=False)
    """Relationship to Interview (one-to-one)"""
    
    def __repr__(self):
        return f"<Survey(id={self.id}, interview_id={self.interview_id}, rating={self.rating})>"
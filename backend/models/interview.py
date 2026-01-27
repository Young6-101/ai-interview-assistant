from sqlalchemy import Column, String, DateTime, Integer, JSON, ForeignKey, Enum
from sqlalchemy.orm import relationship
from database.db import Base
from datetime import datetime
import uuid
import enum

class InterviewStatus(str, enum.Enum):
    """Interview status enumeration"""
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

class InterviewMode(str, enum.Enum):
    """Interview mode enumeration"""
    MODE_1 = "mode1"  # Keep current interface
    MODE_2 = "mode2"  # Show AI popup when using AI
    MODE_3 = "mode3"  # Always show popup

class Interview(Base):
    """
    Interview model for storing interview session records.
    Stores all interview data including transcripts, weak points, and questions.
    """
    __tablename__ = "interviews"
    
    # Primary key
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    """Unique interview ID (UUID)"""
    
    # Foreign key
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    """Reference to the HR interviewer (User)"""
    
    # Interview information
    candidate_name = Column(String(100), nullable=True)
    """Candidate's name"""
    
    candidate_email = Column(String(100), nullable=True)
    """Candidate's email address"""
    
    mode = Column(Enum(InterviewMode), default=InterviewMode.MODE_1)
    """Interview mode: mode1, mode2, or mode3"""
    
    status = Column(Enum(InterviewStatus), default=InterviewStatus.ONGOING)
    """Interview status: ongoing, completed, or cancelled"""
    
    # Interview timing
    start_time = Column(DateTime, default=datetime.utcnow)
    """Interview start timestamp"""
    
    end_time = Column(DateTime, nullable=True)
    """Interview end timestamp"""
    
    duration = Column(Integer, nullable=True)
    """Interview duration in seconds"""
    
    # Interview data (stored as JSON)
    transcript = Column(JSON, default=dict)
    """
    Interview transcript.
    Format: {
        "speaker": "text",  # speaker can be "hr", "candidate", or "system"
        ...
    }
    """
    
    weak_points = Column(JSON, default=list)
    """
    Identified weak points during interview.
    Format: [
        {
            "question": "What is your weakness?",
            "analysis": "Candidate struggled with technical details",
            "skill": "Technical Knowledge"
        },
        ...
    ]
    """
    
    questions_asked = Column(JSON, default=list)
    """
    List of questions asked during interview.
    Format: ["Question 1", "Question 2", ...]
    """
    
    suggested_questions = Column(JSON, default=list)
    """
    AI-suggested follow-up questions.
    Format: [
        {
            "question": "Can you elaborate on...",
            "skill": "Communication",
            "type": "follow_up"
        },
        ...
    ]
    """
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    """Interview record creation timestamp"""
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    """Interview record last update timestamp"""
    
    # Relationship
    user = relationship("User", backref="interviews")
    """Relationship to User (HR interviewer)"""
    
    def __repr__(self):
        return f"<Interview(id={self.id}, candidate={self.candidate_name}, mode={self.mode}, status={self.status})>"
    
    def calculate_duration(self):
        """
        Calculate interview duration in seconds.
        Returns None if interview is still ongoing.
        """
        if self.end_time and self.start_time:
            delta = self.end_time - self.start_time
            self.duration = int(delta.total_seconds())
            return self.duration
        return None
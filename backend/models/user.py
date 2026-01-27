from sqlalchemy import Column, String, DateTime, Boolean
from database.db import Base
from datetime import datetime
import uuid

class User(Base):
    """
    User model for storing HR interviewer and admin information.
    """
    __tablename__ = "users"
    
    # Primary key
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    """Unique user ID (UUID)"""
    
    # User credentials
    username = Column(String(50), unique=True, nullable=False, index=True)
    """Unique username for login"""
    
    email = Column(String(100), unique=True, nullable=False, index=True)
    """User email address"""
    
    hashed_password = Column(String(255), nullable=False)
    """Hashed password (using bcrypt)"""
    
    # User information
    full_name = Column(String(100), nullable=True)
    """User's full name"""
    
    # Account status
    is_active = Column(Boolean, default=True)
    """Whether the user account is active"""
    
    role = Column(String(20), default="hr")
    """User role: 'hr' for interviewer, 'admin' for administrator"""
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    """Account creation timestamp"""
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    """Last account update timestamp"""
    
    def __repr__(self):
        return f"<User(id={self.id}, username={self.username}, role={self.role})>"
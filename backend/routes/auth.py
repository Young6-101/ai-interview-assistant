from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import timedelta
from pydantic import BaseModel, EmailStr
from database.db import get_db
from models.user import User
from utils.security import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user
)
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])

# ============ Request/Response Models ============

class LoginRequest(BaseModel):
    """Login request model"""
    username: str
    password: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "username": "hr_user",
                "password": "secure_password"
            }
        }

class RegisterRequest(BaseModel):
    """User registration request model"""
    username: str
    email: EmailStr
    password: str
    full_name: str = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "username": "new_hr",
                "email": "hr@company.com",
                "password": "secure_password",
                "full_name": "John Doe"
            }
        }

class TokenResponse(BaseModel):
    """Token response model"""
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "username": "hr_user"
            }
        }

class UserResponse(BaseModel):
    """User response model"""
    id: str
    username: str
    email: str
    full_name: str = None
    role: str
    is_active: bool
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "username": "hr_user",
                "email": "hr@company.com",
                "full_name": "John Doe",
                "role": "hr",
                "is_active": True
            }
        }

# ============ Login Endpoint ============

@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    User login endpoint.
    
    Authenticates user with username and password.
    Returns JWT access token if credentials are valid.
    
    Args:
        request: LoginRequest with username and password
        db: Database session
        
    Returns:
        TokenResponse with access token and user info
        
    Raises:
        HTTPException 401: Invalid credentials
        HTTPException 403: User account is inactive
    """
    try:
        # Query user by username
        user = db.query(User).filter(User.username == request.username).first()
        
        # Check if user exists
        if not user:
            logger.warning(f"Login failed: User not found - {request.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        # Verify password
        if not verify_password(request.password, user.hashed_password):
            logger.warning(f"Login failed: Invalid password - {request.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        # Check if user is active
        if not user.is_active:
            logger.warning(f"Login failed: User inactive - {request.username}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive"
            )
        
        # Create access token
        access_token = create_access_token(
            data={"sub": user.id},
            expires_delta=timedelta(minutes=480)  # 8 hours
        )
        
        logger.info(f"User logged in successfully: {request.username}")
        
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            user_id=user.id,
            username=user.username
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed"
        )

# ============ Register Endpoint ============

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    request: RegisterRequest,
    db: Session = Depends(get_db)
):
    """
    User registration endpoint.
    
    Creates new user account with provided credentials.
    Returns JWT access token immediately after registration.
    
    Args:
        request: RegisterRequest with user details
        db: Database session
        
    Returns:
        TokenResponse with access token for new user
        
    Raises:
        HTTPException 400: Username or email already exists
        HTTPException 500: Registration failed
    """
    try:
        # Check if username already exists
        existing_user = db.query(User).filter(
            User.username == request.username
        ).first()
        if existing_user:
            logger.warning(f"Registration failed: Username already exists - {request.username}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists"
            )
        
        # Check if email already exists
        existing_email = db.query(User).filter(
            User.email == request.email
        ).first()
        if existing_email:
            logger.warning(f"Registration failed: Email already exists - {request.email}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists"
            )
        
        # Create new user
        new_user = User(
            username=request.username,
            email=request.email,
            hashed_password=hash_password(request.password),
            full_name=request.full_name,
            role="hr"  # Default role
        )
        
        # Save to database
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        logger.info(f"New user registered: {request.username}")
        
        # Create access token
        access_token = create_access_token(
            data={"sub": new_user.id},
            expires_delta=timedelta(minutes=480)  # 8 hours
        )
        
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            user_id=new_user.id,
            username=new_user.username
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed"
        )

# ============ Get Current User Profile ============

@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user)
):
    """
    Get current authenticated user's profile.
    
    Requires valid JWT token in Authorization header.
    
    Args:
        current_user: Current authenticated user (from JWT)
        
    Returns:
        UserResponse with user information
        
    Raises:
        HTTPException 401: Invalid or missing token
    """
    return current_user

# ============ Change Password ============

@router.post("/change-password")
async def change_password(
    old_password: str,
    new_password: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Change current user's password.
    
    Requires valid JWT token and correct old password.
    
    Args:
        old_password: Current password for verification
        new_password: New password to set
        current_user: Current authenticated user
        db: Database session
        
    Returns:
        Dictionary with success message
        
    Raises:
        HTTPException 401: Old password is incorrect
        HTTPException 500: Password change failed
    """
    try:
        # Verify old password
        if not verify_password(old_password, current_user.hashed_password):
            logger.warning(f"Password change failed: Invalid old password - {current_user.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Old password is incorrect"
            )
        
        # Update password
        current_user.hashed_password = hash_password(new_password)
        db.add(current_user)
        db.commit()
        
        logger.info(f"Password changed: {current_user.username}")
        
        return {"message": "Password changed successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Password change error: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Password change failed"
        )
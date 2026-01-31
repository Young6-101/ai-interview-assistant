"""Authentication routes"""

import logging
from datetime import datetime
from uuid import uuid4
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.state import login_records, state_lock
from utils.auth import generate_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    candidate_name: str
    mode: Literal['mode1', 'mode2', 'mode3']


class LoginResponse(BaseModel):
    candidate_id: str
    candidate_name: str
    mode: str
    recorded_at: str
    access_token: str
    token_type: str = 'Bearer'

@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Record a candidate name and preferred mode for testing."""
    candidate_name = request.candidate_name.strip()
    if not candidate_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Candidate name cannot be empty"
        )

    mode = request.mode.lower()
    candidate_id = f"candidate_{uuid4().hex[:8]}"
    recorded_at = datetime.utcnow().isoformat()
    token = generate_token(candidate_name)

    async with state_lock:
        login_records[candidate_id] = {
            "candidate_name": candidate_name,
            "mode": mode,
            "recorded_at": recorded_at
        }

    logger.info(f"📝 Recorded candidate '{candidate_name}' with mode '{mode}'")

    return LoginResponse(
        candidate_id=candidate_id,
        candidate_name=candidate_name,
        mode=mode,
        recorded_at=recorded_at,
        access_token=token
    )

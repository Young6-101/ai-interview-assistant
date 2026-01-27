from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
import logging
import json
from sqlalchemy.orm import Session

from config.settings import settings
from database.db import init_db, get_db
from routes import auth, interview, survey
from websocket.handler import ws_handler
from utils.security import decode_token

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    description="AI Interview Assistant API",
    docs_url="/docs",
    openapi_url="/openapi.json"
)

# ============ CORS Middleware ============

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info(f"CORS enabled for origins: {settings.ALLOWED_ORIGINS}")

# ============ Event Handlers ============

@app.on_event("startup")
async def startup_event():
    """
    Initialize application on startup.
    - Create database tables
    - Log startup info
    """
    try:
        init_db()
        logger.info("✅ Application started successfully")
        logger.info(f"📊 API docs available at: http://localhost:{settings.PORT}/docs")
    except Exception as e:
        logger.error(f"❌ Failed to start application: {str(e)}")
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """
    Cleanup on application shutdown.
    """
    logger.info("❌ Application shutdown")

# ============ Health Check ============

@app.get("/health", tags=["health"])
async def health_check():
    """
    Health check endpoint.
    Returns application status.
    """
    return {
        "status": "healthy",
        "service": settings.API_TITLE,
        "version": settings.API_VERSION
    }

# ============ Include Routers ============

app.include_router(auth.router)
app.include_router(interview.router)
app.include_router(survey.router)

logger.info("✅ All routers registered")

# ============ WebSocket Endpoint ============

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str,
    interview_id: str,
    db: Session = Depends(get_db)
):
    """
    WebSocket endpoint for real-time interview processing.
    
    Handles:
    - Screen sharing status
    - Real-time transcription
    - AI analysis and suggestions
    - Interview data collection
    
    Query Parameters:
        token: JWT authentication token
        interview_id: Interview ID for this session
    
    Message Types:
        transcript: {type: "transcript", speaker: "hr|candidate", text: "..."}
        question: {type: "question", question: "..."}
        weak_points: {type: "weak_points", data: [...]}
        suggested_questions: {type: "suggested_questions", data: [...]}
        end_interview: {type: "end_interview"}
    """
    user_id = None
    
    try:
        # Authenticate user via JWT token
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
            
            if not user_id:
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
                logger.warning("WebSocket connection rejected: Invalid token")
                return
        except Exception as e:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication failed")
            logger.warning(f"WebSocket authentication failed: {str(e)}")
            return
        
        # Connect and setup interview session
        await ws_handler.connect(websocket, user_id, interview_id)
        
        # Message processing loop
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get("type")
            
            # Handle different message types
            if message_type == "transcript":
                # Process transcript data
                speaker = message.get("speaker")  # "hr" or "candidate"
                text = message.get("text")
                
                await ws_handler.handle_transcript(user_id, speaker, text)
            
            elif message_type == "question":
                # Record question asked
                question = message.get("question")
                await ws_handler.handle_question_asked(user_id, question)
            
            elif message_type == "weak_points":
                # Receive weak points analysis
                weak_points = message.get("data", [])
                await ws_handler.handle_weak_points(user_id, weak_points)
            
            elif message_type == "suggested_questions":
                # Receive suggested questions
                questions = message.get("data", [])
                await ws_handler.handle_suggested_questions(user_id, questions)
            
            elif message_type == "heartbeat":
                # Keep-alive heartbeat
                await ws_handler.send_personal(user_id, {
                    "type": "heartbeat_ack",
                    "status": "alive"
                })
            
            elif message_type == "end_interview":
                # End interview and save to database
                logger.info(f"Interview ending: user={user_id}")
                
                # Save to database
                interview_id = await ws_handler.save_interview_to_db(user_id, db)
                
                # Send confirmation
                await ws_handler.send_personal(user_id, {
                    "type": "interview_saved",
                    "interview_id": interview_id,
                    "message": "Interview saved successfully"
                })
                
                break
            
            else:
                logger.warning(f"Unknown message type: {message_type}")
    
    except WebSocketDisconnect:
        # Client disconnected
        logger.info(f"Client disconnected: {user_id}")
        ws_handler.disconnect(user_id)
    
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON message: {str(e)}")
        ws_handler.disconnect(user_id)
    
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        ws_handler.disconnect(user_id)
        try:
            await websocket.close(code=status.WS_1011_SERVER_ERROR, reason="Server error")
        except:
            pass

# ============ Root Endpoint ============

@app.get("/", tags=["root"])
async def root():
    """
    Root endpoint.
    Returns API information.
    """
    return {
        "message": "AI Interview Assistant API",
        "version": settings.API_VERSION,
        "docs": "/docs",
        "health": "/health"
    }

# ============ Run Application ============

if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Starting server on {settings.HOST}:{settings.PORT}")
    
    uvicorn.run(
        app,
        host=settings.HOST,
        port=settings.PORT,
        log_level="info"
    )
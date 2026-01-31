import os
import logging
from dotenv import load_dotenv
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import routers
from routes import auth, interview, config

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============ APPLICATION SETUP ============

app = FastAPI(
    title="AI Interview Assistant",
    version="1.0.0",
    description="Simplified backend for AI Interview"
)

# Add CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(interview.router)
app.include_router(config.router)

# ============ HEALTH CHECK ============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "AI Interview Assistant API",
        "version": "1.0.0"
    }

# ============ RUN ============

if __name__ == "__main__":
    logger.info(f"Starting server on 127.0.0.1:8000")
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info"
    )


from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    """
    Application settings and configuration management.
    Loads environment variables from .env file.
    """
    
    # ============ API Configuration ============
    API_TITLE: str = "AI Interview Assistant"
    API_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # ============ Server Configuration ============
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # ============ Database Configuration ============
    DATABASE_URL: str
    """PostgreSQL database connection string"""
    
    # ============ Redis Configuration ============
    REDIS_URL: str
    """Redis connection string for caching and message queue"""
    
    # ============ AI Services Configuration ============
    OPENAI_API_KEY: str
    """OpenAI API key for GPT models and Realtime API"""
    
    ASSEMBLYAI_API_KEY: str
    """AssemblyAI API key for real-time speech-to-text"""
    
    # ============ JWT Authentication Configuration ============
    SECRET_KEY: str = "your-secret-key-change-in-production"
    """Secret key for JWT token signing - change in production"""
    
    ALGORITHM: str = "HS256"
    """JWT algorithm for token encoding"""
    
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    """JWT token expiration time in minutes (8 hours)"""
    
    # ============ CORS Configuration ============
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative frontend port
        "http://localhost:8000",  # Same origin
    ]
    """Allowed origins for CORS requests"""
    
    # ============ WebSocket Configuration ============
    WS_HEARTBEAT_INTERVAL: int = 30
    """WebSocket heartbeat interval in seconds"""
    
    WS_RECONNECT_TIMEOUT: int = 60
    """WebSocket reconnection timeout in seconds"""
    
    class Config:
        env_file = ".env"
        """Load environment variables from .env file"""
        
        env_file_encoding = "utf-8"
        case_sensitive = False

# Create global settings instance
settings = Settings()
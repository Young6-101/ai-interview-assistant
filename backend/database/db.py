from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base
from config.settings import settings
import logging

logger = logging.getLogger(__name__)

# Create database engine
engine = create_engine(
    settings.DATABASE_URL,
    echo=False,  # Set to True for SQL query logging
    pool_size=20,
    max_overflow=0,
    pool_pre_ping=True,  # Test connections before using
)

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)

# Base class for all database models
Base = declarative_base()

def get_db() -> Session:
    """
    Dependency function to get database session.
    Used in FastAPI route handlers.
    
    Example:
        @app.get("/items")
        def read_items(db: Session = Depends(get_db)):
            items = db.query(Item).all()
            return items
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database session error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()

def init_db():
    """
    Initialize database tables.
    Call this once at application startup.
    
    Creates all tables defined in models using SQLAlchemy ORM.
    """
    try:
        # Import all models to register them with Base
        from models.user import User
        from models.interview import Interview
        from models.survey import Survey
        
        # Create all tables
        Base.metadata.create_all(bind=engine)
        logger.info("✅ Database tables initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize database: {str(e)}")
        raise

def drop_all_tables():
    """
    Drop all database tables.
    WARNING: This will delete all data. Use only in development!
    """
    try:
        Base.metadata.drop_all(bind=engine)
        logger.warning("⚠️ All database tables dropped")
    except Exception as e:
        logger.error(f"❌ Failed to drop tables: {str(e)}")
        raise

def reset_db():
    """
    Reset database: drop all tables and recreate them.
    WARNING: This will delete all data. Use only in development!
    """
    drop_all_tables()
    init_db()
    logger.info("✅ Database reset completed")
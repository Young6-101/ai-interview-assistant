# AI Interview Assistant

An intelligent real-time interview assistance system that provides AI-powered question analysis, answer evaluation, and follow-up question generation to help HR professionals conduct more effective technical interviews.

## Features

### 🎯 Three Operating Modes
- **Mode 1**: Fully transparent AI assistance - Candidate is aware of AI support
- **Mode 2**: Semi-transparent - AI assistance with timed warnings to candidate
- **Mode 3**: Stealth mode - AI assistance without candidate awareness

### 🤖 AI-Powered Analysis
- **Real-time Question Classification**: Automatically categorizes HR questions (behavioral, technical, situational)
- **Answer Quality Evaluation**: Scores candidate responses using STAR framework analysis
- **Weak Point Detection**: Identifies gaps in candidate answers
- **Follow-up Question Generation**: Suggests targeted questions based on detected weaknesses

### 🎙️ Audio & Video
- **Dual Audio Capture**: Separate recording for HR and candidate
- **Screen Sharing**: Share meeting room or application windows
- **Real-time Transcription**: Live speech-to-text using AssemblyAI
- **Transcript Management**: Organized conversation history with speaker identification

### 📊 Interview Management
- **Session Persistence**: Automatic JSON export of interview data
- **Transcript Export**: Complete conversation records with timestamps
- **Analysis History**: Saved AI evaluations and generated questions

## Architecture

### System Overview
```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Frontend      │ ◄─────► │    Backend       │ ◄─────► │  External APIs  │
│   (React)       │  WS/HTTP│   (FastAPI)      │  HTTPS  │  - OpenAI       │
│   - Nginx       │         │   - Python       │         │  - AssemblyAI   │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │
        │                            │
        ▼                            ▼
┌─────────────────┐         ┌──────────────────┐
│  Browser APIs   │         │  File Storage    │
│  - MediaStream  │         │  - JSON exports  │
│  - WebRTC       │         │  - Transcripts   │
└─────────────────┘         └──────────────────┘
```

### Communication Flow
1. **Frontend** captures audio/video via Browser MediaStream API
2. **WebSocket** connection streams real-time transcription data
3. **Backend** processes transcripts and triggers AI analysis
4. **OpenAI API** performs question classification and answer evaluation
5. **Results** pushed back to frontend via WebSocket
6. **Session data** persisted to JSON files on backend

## Technology Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **State Management**: React Context API
- **Routing**: React Router v6
- **HTTP Client**: Axios
- **Real-time Communication**: WebSocket
- **Server**: Nginx (production)

### Backend
- **Framework**: FastAPI (Python 3.11+)
- **ASGI Server**: Uvicorn
- **WebSocket**: Native FastAPI WebSocket support
- **Authentication**: JWT tokens
- **Environment**: python-dotenv

### AI & APIs
- **LLM**: OpenAI GPT-4
- **Speech-to-Text**: AssemblyAI Real-time API
- **Analysis Framework**: STAR method (Situation, Task, Action, Result)

### DevOps
- **Containerization**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **Registry**: Docker Hub
- **Deployment**: Azure VM (Ubuntu)

## Quick Start

### Prerequisites
- Docker & Docker Compose
- OpenAI API Key
- AssemblyAI API Key

### Local Development

1. **Clone the repository**
```bash
git clone https://github.com/Young6-101/ai-interview-assistant.git
cd ai-interview-assistant
```

2. **Configure environment variables**
```bash
# Create .env file in project root
cp .env.example .env

# Edit .env and add your API keys
OPENAI_API_KEY=sk-...
ASSEMBLYAI_API_KEY=...
```

3. **Start services**
```bash
docker-compose up -d
```

4. **Access the application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Production Deployment

The project uses GitHub Actions for automated deployment:

1. **Configure GitHub Secrets**:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
   - `AZURE_VM_HOST`
   - `AZURE_VM_USERNAME`
   - `AZURE_VM_SSH_KEY`

2. **Push to main branch**:
```bash
git push origin main
```

3. GitHub Actions will automatically:
   - Build Docker images
   - Push to Docker Hub
   - Deploy to Azure VM

## Project Structure

```
ai-interview-assistant/
├── backend/
│   ├── main.py              # FastAPI application entry
│   ├── routes/              # API endpoints
│   │   ├── auth.py          # Authentication
│   │   ├── interview.py     # Interview & WebSocket
│   │   └── config.py        # Configuration
│   ├── services/            # Business logic
│   │   └── realtime_analyzer.py  # AI analysis
│   ├── core/                # Core utilities
│   ├── utils/               # Helper functions
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/           # React pages
│   │   ├── contexts/        # Context providers
│   │   ├── hooks/           # Custom hooks
│   │   ├── services/        # API clients
│   │   └── components/      # Reusable components
│   ├── nginx.conf           # Nginx configuration
│   └── Dockerfile
├── .github/
│   └── workflows/
│       └── deploy.yml       # CI/CD pipeline
├── docker-compose.yml       # Service orchestration
└── README.md
```

## API Documentation

### REST Endpoints
- `POST /auth/login` - User authentication
- `POST /api/interview/create` - Create interview session
- `POST /api/interview/{id}/save` - Save interview data
- `GET /api/config/assemblyai` - Get AssemblyAI configuration

### WebSocket
- `WS /ws` - Real-time interview communication
  - Events: `start`, `transcript`, `request_analysis`, `pause`, `resume`, `end`

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on GitHub.

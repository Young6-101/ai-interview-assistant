
import os
import json
import base64
import asyncio
import logging
import websockets
from datetime import datetime

logger = logging.getLogger(__name__)

class OpenAIRealtimeService:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            logger.error("Missing OPENAI_API_KEY")
        
        self.url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01"
        self.ws = None
        
        # Hardcoded JD for V2-Lite
        self.jd_text = """**Job Title: Senior Software Engineer (AI/ML Focus)**
**Responsibilities:**
- Design, build, and maintain high-performance, reusable, and reliable Python and TypeScript code.
- Integrate third-party AI services (OpenAI, Anthropic) into core product workflows.
- Optimize real-time audio processing pipelines for low latency.
- Collaborate with cross-functional teams to define, design, and ship new features.

**Requirements:**
- 5+ years of experience in software engineering.
- Proficient in Python (FastAPI) and React (TypeScript).
- Experience with WebSocket APIs and real-time data streaming.
- Strong understanding of system design and scalable architecture.
- Bonus: Experience with WebRTC or Audio Processing."""

        self.session_config = {
            "modalities": ["text"],
            "instructions": f"""
            You are an expert technical interview copilot.
            1. Transcribe the user's audio accurately.
            2. After the user finishes an answer, IMMEDIATELY generate 3 strategic follow-up questions using the 'submit_interview_suggestions' tool.
            
            CONTEXT (Job Description):
            {self.jd_text}
            
            The 3 questions MUST follow this structure:
            1. 'deep_dive': A specific follow-up based on the candidate's answer (probing details, STAR gaps, or technical logic).
            2. 'jd_alignment': A question checking if they have specific skills/experience required for the role (based on the provided JD).
            3. 'strategic': A broader question about system design, soft skills, or problem-solving.

            3. Call 'submit_interview_suggestions' to submit these 3 questions.
            4. Do NOT generate spoken audio responses, ONLY use the tool.
            """,
            "voice": "alloy",
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 500
            },
            "tools": [
                {
                    "type": "function",
                    "name": "submit_interview_suggestions",
                    "description": "Submit 3 strategic follow-up questions based on the candidate's answer.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "suggestions": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "type": {
                                            "type": "string",
                                            "enum": ["deep_dive", "jd_alignment", "strategic"],
                                            "description": "Category of the question"
                                        },
                                        "question": {
                                            "type": "string",
                                            "description": "The actual question to ask the candidate."
                                        },
                                        "reasoning": {
                                            "type": "string",
                                            "description": "Why this question is important (brief)."
                                        }
                                    },
                                    "required": ["type", "question", "reasoning"]
                                }
                            }
                        },
                        "required": ["suggestions"]
                    }
                }
            ],
            "tool_choice": "auto"
        }

    async def connect(self):
        """Establish WebSocket connection to OpenAI"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "OpenAI-Beta": "realtime=v1"
        }
        try:
            self.ws = await websockets.connect(self.url, extra_headers=headers)
            logger.info("✅ Connected to OpenAI Realtime API")
            
            # Send session configuration
            await self.ws.send(json.dumps({
                "type": "session.update",
                "session": self.session_config
            }))
            logger.info("⚙️ Session configuration sent")
            
        except Exception as e:
            logger.error(f"Failed to connect to OpenAI: {e}")
            raise

    async def disconnect(self):
        if self.ws:
            await self.ws.close()
            logger.info("🔌 Disconnected from OpenAI")

    async def send_audio_chunk(self, audio_bytes: bytes):
        """Send raw PCM16 audio chunk to OpenAI"""
        if not self.ws: return
        
        # Audio must be base64 encoded for the JSON event
        base64_audio = base64.b64encode(audio_bytes).decode('utf-8')
        
        await self.ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": base64_audio
        }))

    async def send_text_instruction(self, text: str):
        """Send a text instruction (system/user message) to trigger response"""
        if not self.ws: return
        
        try:
            # 1. Add User Message Item
            await self.ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": text
                        }
                    ]
                }
            }))
            
            # 2. Trigger Response
            await self.ws.send(json.dumps({
                "type": "response.create",
                "response": {
                    "modalities": ["text"],
                    "instructions": "Please generate suggestions now."
                }
            }))
            logger.info(f"📤 Sent text instruction: {text}")
            
        except Exception as e:
            logger.error(f"Failed to send text: {e}")

    async def listen(self):
        """Generator that yields relevant events from OpenAI"""
        if not self.ws: return
        
        try:
            async for message in self.ws:
                event = json.loads(message)
                event_type = event.get("type")
                
                # Log interesting events (filters out audio noise)
                if event_type not in ["response.audio.delta", "response.audio_transcript.delta"]:
                    pass # Logger noisy events if needed
                
                # 1. Transcript (Final)
                if event_type == "conversation.item.input_audio_transcription.completed":
                    yield {
                        "type": "transcript",
                        "text": event.get("transcript", ""),
                        "is_final": True
                    }

                # 2. Function Call (The AI wants to submit analysis)
                elif event_type == "response.function_call_arguments.done":
                    # Parse the arguments JSON
                    try:
                        args = json.loads(event.get("arguments", "{}"))
                        yield {
                            "type": "analysis",
                            "payload": args
                        }
                    except Exception as e:
                        logger.error(f"Failed to parse function args: {e}")

                # 3. Error Handling
                elif event_type == "error":
                    logger.error(f"OpenAI Error: {event.get('error')}")

        except Exception as e:
            logger.error(f"Error reading from OpenAI: {e}")

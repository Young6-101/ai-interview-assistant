
import os
import json
import base64
import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Hardcoded JD for V2-Lite (shared by all instances)
JD_TEXT = """**Job Title: Senior Software Engineer (AI/ML Focus)**
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


class OpenAIRealtimeService:
    """
    Single OpenAI Realtime connection for one audio source (HR or Candidate).
    """
    def __init__(self, speaker: str = "candidate", enable_tools: bool = True):
        """
        Args:
            speaker: "hr" or "candidate" - identifies the audio source
            enable_tools: If True, enable function calling for question generation (only for candidate)
        """
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            logger.error("Missing OPENAI_API_KEY")
        
        self.url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
        self.ws = None
        self.speaker = speaker
        self.enable_tools = enable_tools
        self._chunk_count = 0
        
        # Build session config based on role
        self.session_config = self._build_session_config()

    def _build_session_config(self):
        """Build session config based on speaker role"""
        base_config = {
            "modalities": ["text", "audio"],
            "input_audio_transcription": {
                "model": "whisper-1"
            },
            "voice": "alloy",
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.5,
                "prefix_padding_ms": 300,
                "silence_duration_ms": 600
            }
        }
        
        if self.speaker == "candidate" and self.enable_tools:
            # Candidate connection: transcribe + generate questions
            base_config["instructions"] = f"""
            You are an expert technical interview copilot listening to a CANDIDATE's responses.
            1. Transcribe the candidate's audio accurately.
            2. After the candidate finishes an answer, IMMEDIATELY generate 3 strategic follow-up questions using the 'submit_interview_suggestions' tool.
            
            CONTEXT (Job Description):
            {JD_TEXT}
            
            The 3 questions MUST follow this structure:
            1. 'deep_dive': A specific follow-up based on the candidate's answer (probing details, STAR gaps, or technical logic).
            2. 'jd_alignment': A question checking if they have specific skills/experience required for the role (based on the provided JD).
            3. 'strategic': A broader question about system design, soft skills, or problem-solving.

            Call 'submit_interview_suggestions' to submit these 3 questions.
            Do NOT generate spoken audio responses, ONLY use the tool.
            """
            base_config["tools"] = [
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
            ]
            base_config["tool_choice"] = "auto"
        else:
            # HR connection: transcribe only, no tools needed
            base_config["instructions"] = """
            You are transcribing an HR interviewer's speech.
            Transcribe the audio accurately. Do NOT generate any responses or use any tools.
            """
        
        return base_config

    async def connect(self):
        """Establish WebSocket connection to OpenAI"""
        headers = [
            ("Authorization", f"Bearer {self.api_key}"),
            ("OpenAI-Beta", "realtime=v1")
        ]
        try:
            from websockets.asyncio.client import connect
            self.ws = await connect(self.url, additional_headers=headers)
            logger.info(f"✅ [{self.speaker.upper()}] Connected to OpenAI Realtime API")
            
            # Wait for session.created event first
            response = await self.ws.recv()
            event = json.loads(response)
            if event.get("type") == "session.created":
                logger.info(f"📩 [{self.speaker.upper()}] Session created")
            
            # Send session configuration
            await self.ws.send(json.dumps({
                "type": "session.update",
                "session": self.session_config
            }))
            logger.info(f"⚙️ [{self.speaker.upper()}] Session configuration sent")
            
            # Wait for session.updated confirmation
            response = await self.ws.recv()
            event = json.loads(response)
            if event.get("type") == "session.updated":
                logger.info(f"✅ [{self.speaker.upper()}] Session updated, transcription enabled")
            elif event.get("type") == "error":
                logger.error(f"❌ [{self.speaker.upper()}] Session update error: {event.get('error')}")
            
        except Exception as e:
            logger.error(f"[{self.speaker.upper()}] Failed to connect to OpenAI: {e}")
            raise

    async def disconnect(self):
        if self.ws:
            await self.ws.close()
            logger.info(f"🔌 [{self.speaker.upper()}] Disconnected from OpenAI")

    async def send_audio_chunk(self, audio_bytes: bytes):
        """Send raw PCM16 audio chunk to OpenAI"""
        if not self.ws: 
            return
        
        base64_audio = base64.b64encode(audio_bytes).decode('utf-8')
        
        self._chunk_count += 1
        if self._chunk_count % 100 == 0:
            logger.info(f"🎵 [{self.speaker.upper()}] Sent {self._chunk_count} audio chunks")
        
        await self.ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": base64_audio
        }))

    async def send_text_instruction(self, text: str):
        """Send a text instruction to trigger response (for question generation)"""
        if not self.ws or not self.enable_tools:
            return
        
        try:
            await self.ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": text}]
                }
            }))
            
            await self.ws.send(json.dumps({
                "type": "response.create",
                "response": {
                    "modalities": ["text"],
                    "instructions": "Please generate suggestions now."
                }
            }))
            logger.info(f"📤 [{self.speaker.upper()}] Sent text instruction")
            
        except Exception as e:
            logger.error(f"[{self.speaker.upper()}] Failed to send text: {e}")

    async def listen(self):
        """Generator that yields relevant events from OpenAI"""
        if not self.ws:
            return
        
        try:
            async for message in self.ws:
                event = json.loads(message)
                event_type = event.get("type")
                
                # Log important events
                if event_type == "input_audio_buffer.speech_started":
                    logger.info(f"🎤 [{self.speaker.upper()}] Speech detected")
                    # Yield interim "speaking" state for real-time UI feedback
                    yield {
                        "type": "speech_started",
                        "speaker": self.speaker
                    }
                elif event_type == "input_audio_buffer.speech_stopped":
                    logger.info(f"🔇 [{self.speaker.upper()}] Speech ended")
                
                # 1. Transcript
                if event_type == "conversation.item.input_audio_transcription.completed":
                    transcript_text = event.get("transcript", "")
                    if transcript_text.strip():  # Only yield non-empty transcripts
                        logger.info(f"📝 [{self.speaker.upper()}] Transcript: {transcript_text[:80]}...")
                        yield {
                            "type": "transcript",
                            "text": transcript_text,
                            "speaker": self.speaker,
                            "is_final": True
                        }

                # 2. Function Call (only for candidate with tools enabled)
                elif event_type == "response.function_call_arguments.done" and self.enable_tools:
                    try:
                        args = json.loads(event.get("arguments", "{}"))
                        logger.info(f"🔧 [{self.speaker.upper()}] Function call: {len(args.get('suggestions', []))} suggestions")
                        yield {
                            "type": "analysis",
                            "payload": args
                        }
                    except Exception as e:
                        logger.error(f"[{self.speaker.upper()}] Failed to parse function args: {e}")

                # 3. Error Handling
                elif event_type == "error":
                    logger.error(f"❌ [{self.speaker.upper()}] OpenAI Error: {event.get('error')}")

        except Exception as e:
            logger.error(f"[{self.speaker.upper()}] Error reading from OpenAI: {e}")

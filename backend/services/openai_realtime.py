
import os
import json
import base64
import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# Hardcoded JD for V2-Lite (shared by all instances)
JD_TEXT = """**Job Title: Research Assistant – HCI Lab**
**Requirements:**
- Current/recent student or graduate in HCI, Computer Science, Design, Psychology or related field
- Practical experience or strong training in user research / UX methods
- Comfortable with user study facilitation (interviews/tests/surveys)
- Prototyping skills (Figma / Adobe XD / Sketch or similar)
- Data analysis capability:
  • Qualitative: thematic analysis, coding
  • AND/OR quantitative: basic stats in Python / R / SPSS
- Solid academic/technical writing ability
- Available ≥20 hours/week

**Bonus:**
- Prior research project or lab experience
- Familiarity with NVivo, PyTorch, Unity, participatory design
- Interest in mental health & technology, inclusive design, or AI ethics"""


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
                "model": "whisper-1",
                "language": "en"
            },
            "voice": "alloy",
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "turn_detection": {
                "type": "server_vad",
                "threshold": 0.8,  # Increased from 0.5 to reduce noise sensitivity
                "prefix_padding_ms": 300,
                "silence_duration_ms": 600
            }
        }
        
        if self.speaker == "candidate" and self.enable_tools:
            # Candidate connection: transcribe + generate questions
            base_config["instructions"] = f"""
            You are an expert technical interview copilot listening to a CANDIDATE's responses.
            1. Transcribe the candidate's audio accurately.
            2. Do NOT auto-generate questions. ONLY generate questions when you receive an explicit text instruction asking you to do so.
            3. When asked to generate questions, use the 'submit_interview_suggestions' tool to submit exactly 3 questions.
            
            CONTEXT (Job Description):
            {JD_TEXT}
            
            The 3 questions MUST follow this exact structure:

            1. 'follow_up' (Dive Deeper): A specific follow-up based on what the candidate JUST said.
               Probe deeper into their response — ask for details, clarify STAR gaps, challenge technical logic, or request concrete examples.
               This question should feel like a natural continuation of the current topic.

            2. 'move_on' (Assess New Criterion): A "move-on" question that pivots to a DIFFERENT criterion from the Job Description that has NOT been discussed yet in this interview.
               Look at the JD requirements and pick one that the conversation has not covered. Frame the question so it naturally assesses that new criterion.
               Do NOT ask about the same topic the candidate was just discussing.

            3. 'revert' (Revisit Earlier Topic): A "reverting" question that circles back to a criterion or topic that was discussed EARLIER in the interview.
               Use insights from the ongoing conversation to ask a deeper or clarifying question about something previously covered.
               IMPORTANT: If this is the first question round and no prior topics have been discussed yet, instead ask a foundational question about a different JD requirement (similar to move_on but targeting a different criterion). Do NOT pretend there was a previous topic.

            Call 'submit_interview_suggestions' to submit these 3 questions.
            Do NOT generate spoken audio responses, ONLY use the tool.
            """
            base_config["tools"] = [
                {
                    "type": "function",
                    "name": "submit_interview_suggestions",
                    "description": "Submit exactly 3 interview questions, one for each category. Each category MUST be filled.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "follow_up": {
                                "type": "object",
                                "description": "FOLLOW-UP: Dive deeper into what the candidate JUST said. Probe for details, clarify STAR gaps, challenge technical logic, or request concrete examples.",
                                "properties": {
                                    "question": {"type": "string", "description": "The follow-up question to ask."},
                                    "reasoning": {"type": "string", "description": "Why this follow-up is important (brief)."}
                                },
                                "required": ["question", "reasoning"]
                            },
                            "move_on": {
                                "type": "object",
                                "description": "MOVE-ON: Pivot to a DIFFERENT JD criterion NOT yet discussed. Do NOT ask about the same topic the candidate was just discussing.",
                                "properties": {
                                    "question": {"type": "string", "description": "The move-on question targeting a new JD criterion."},
                                    "reasoning": {"type": "string", "description": "Which JD criterion this assesses and why (brief)."}
                                },
                                "required": ["question", "reasoning"]
                            },
                            "revert": {
                                "type": "object",
                                "description": "REVERT: Circle back to a topic discussed EARLIER in the interview with a deeper or clarifying question. If this is the first round, ask about a different JD requirement instead.",
                                "properties": {
                                    "question": {"type": "string", "description": "The revert/revisit question."},
                                    "reasoning": {"type": "string", "description": "What earlier topic this revisits and why (brief)."}
                                },
                                "required": ["question", "reasoning"]
                            }
                        },
                        "required": ["follow_up", "move_on", "revert"]
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
            # Cancel any active response first to avoid conflict
            await self.ws.send(json.dumps({
                "type": "response.cancel"
            }))
            
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
                    yield {
                        "type": "speech_stopped",
                        "speaker": self.speaker
                    }
                
                # 1. Transcript
                if event_type == "conversation.item.input_audio_transcription.completed":
                    transcript_text = event.get("transcript", "")
                    
                    # Check for common Whisper hallucinations caused by environmental noise
                    clean_text = transcript_text.strip().lower()
                    hallucinations = [
                        "thank you.", "thank you", "thanks.", "thanks",
                        "bye.", "bye", "am i right?", "you", 
                        "[silence]", "[blank]", ".", ".."
                    ]
                    is_hallucination = clean_text in hallucinations or len(clean_text) <= 1
                    
                    if transcript_text.strip() and not is_hallucination:
                        logger.info(f"📝 [{self.speaker.upper()}] Transcript: {transcript_text[:80]}...")
                        yield {
                            "type": "transcript",
                            "text": transcript_text,
                            "speaker": self.speaker,
                            "is_final": True
                        }
                    elif transcript_text:
                        logger.info(f"🚫 [{self.speaker.upper()}] Filtered hallucination/noise: '{transcript_text}'")

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

"""Quick test script to verify OpenAI Realtime API connection and audio transcription"""
import os
import json
import asyncio
import struct
import math
import base64
from dotenv import load_dotenv

load_dotenv()

async def test_connection():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ OPENAI_API_KEY not found in environment")
        return
    
    print(f"🔑 API Key: {api_key[:8]}...{api_key[-4:]}")
    
    # Use websockets 16.x compatible import
    from websockets.asyncio.client import connect
    
    model = "gpt-4o-realtime-preview-2024-12-17"
    url = f"wss://api.openai.com/v1/realtime?model={model}"
    headers = [
        ("Authorization", f"Bearer {api_key}"),
        ("OpenAI-Beta", "realtime=v1")
    ]
    
    print(f"\n🔄 Testing model: {model}")
    try:
        ws = await connect(url, additional_headers=headers)
        print(f"✅ Connected to {model}")
        
        # Wait for session.created event
        response = await asyncio.wait_for(ws.recv(), timeout=5)
        event = json.loads(response)
        print(f"📩 Event: {event.get('type')}")
        
        if event.get('type') == 'session.created':
            session = event.get('session', {})
            print(f"   Modalities: {session.get('modalities')}")
            print(f"   Input format: {session.get('input_audio_format')}")
            print(f"   Transcription: {session.get('input_audio_transcription')}")
            
            # Send session update with transcription enabled
            await ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "modalities": ["text", "audio"],
                    "input_audio_transcription": {
                        "model": "whisper-1"
                    },
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "prefix_padding_ms": 300,
                        "silence_duration_ms": 500
                    }
                }
            }))
            print("📤 Sent session.update")
            
            # Wait for session.updated confirmation
            response = await asyncio.wait_for(ws.recv(), timeout=5)
            event = json.loads(response)
            print(f"📩 Event: {event.get('type')}")
            
            if event.get('type') == 'session.updated':
                session = event.get('session', {})
                print(f"   ✅ Transcription enabled: {session.get('input_audio_transcription')}")
                
                # Generate a simple tone as test audio (1 second of 440Hz sine wave)
                sample_rate = 24000
                duration = 2  # 2 seconds
                frequency = 440  # Hz
                
                samples = []
                for i in range(sample_rate * duration):
                    value = int(16000 * math.sin(2 * math.pi * frequency * i / sample_rate))
                    samples.append(struct.pack('<h', value))
                
                audio_bytes = b''.join(samples)
                audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                
                print(f"\n🔊 Sending test audio ({len(audio_bytes)} bytes)...")
                
                # Send audio
                await ws.send(json.dumps({
                    "type": "input_audio_buffer.append",
                    "audio": audio_base64
                }))
                
                # Commit the audio buffer
                await ws.send(json.dumps({
                    "type": "input_audio_buffer.commit"
                }))
                print("📤 Audio sent and committed")
                
                # Listen for events for 10 seconds
                print("\n⏳ Waiting for transcription events (10 seconds)...")
                try:
                    while True:
                        response = await asyncio.wait_for(ws.recv(), timeout=10)
                        event = json.loads(response)
                        event_type = event.get('type')
                        
                        # Skip noisy events
                        if event_type in ['response.audio.delta', 'response.audio_transcript.delta']:
                            continue
                            
                        print(f"📩 Event: {event_type}")
                        
                        if event_type == 'conversation.item.input_audio_transcription.completed':
                            print(f"   📝 TRANSCRIPT: {event.get('transcript', '')}")
                        elif event_type == 'error':
                            print(f"   ❌ Error: {event.get('error')}")
                        elif event_type == 'input_audio_buffer.speech_started':
                            print("   🎤 Speech detected!")
                        elif event_type == 'input_audio_buffer.speech_stopped':
                            print("   🔇 Speech ended")
                        elif event_type == 'input_audio_buffer.committed':
                            print("   ✅ Audio buffer committed")
                            
                except asyncio.TimeoutError:
                    print("⏰ Timeout - no more events")
            
            elif event.get('type') == 'error':
                print(f"   ❌ Error: {event.get('error')}")
        
        await ws.close()
        print("\n✅ Test completed!")
        
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_connection())

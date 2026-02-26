import React, { useEffect, useState } from 'react'
import { useInterview } from '../contexts/InterviewContext'
import { useNavigate } from 'react-router-dom'
import { useWebSocketLite } from '../hooks/useWebSocketLite'
import { useMicrophoneStream } from '../hooks/useMicrophoneStream'
import { MeetingRoomCard } from '../components/interview/MeetingRoomCard'
import { AiQuestionsCard } from '../components/interview/AiQuestionsCard'
import { TranscriptCard } from '../components/interview/TranscriptCard'
import { JobDescriptionCard } from '../components/interview/JobDescriptionCard'

// For production: use relative path (Nginx proxies /ws to backend)
// For development: Vite proxy handles /ws -> localhost:8000
const getWsUrl = () => {
  // If VITE_API_URL is set, use it (for custom deployments)
  if (import.meta.env.VITE_API_URL) {
    const apiUrl = import.meta.env.VITE_API_URL
    // Convert http(s):// to ws(s)://
    return apiUrl.replace(/^http/, 'ws') + '/ws'
  }
  
  // Use relative path - works for both:
  // - Dev: Vite proxy handles /ws -> localhost:8000
  // - Prod: Nginx proxy handles /ws -> backend:8000
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

const WS_URL = getWsUrl()
console.log('🌐 WebSocket URL:', WS_URL)


export const Interview: React.FC = () => {
  const context = useInterview()
  const navigate = useNavigate()
  const [error, setError] = useState<string>('')

  // Debug: log token
  console.log('🔑 Token for WS:', context.token || 'temp_token')

  // Use ref to track interview state for audio callback (avoids stale closure)
  const interviewStateRef = React.useRef(context.interviewState)
  React.useEffect(() => {
    interviewStateRef.current = context.interviewState
  }, [context.interviewState])

  // 1. WebSocket Hook (Lite)
  const { isConnected, sendMessage, disconnect } = useWebSocketLite({
    url: WS_URL,
    token: context.token || 'temp_token',
    onMessage: (msg: any) => {
      console.log('📩 WS Message:', msg.type, msg);  // Debug log

      if (msg.type === 'transcript_update') {
        const payload = msg.payload
        console.log('📝 Adding transcript:', payload);  // Debug log
        context.addTranscript({
          id: payload.id || `t_${payload.timestamp}`,
          // speaker from backend: "hr" or "candidate"
          speaker: payload.speaker === 'hr' ? 'HR' : 'Candidate',
          text: payload.text,
          timestamp: payload.timestamp,
          isFinal: payload.is_final
        })
      } else if (msg.type === 'transcript_replace') {
        // Replace an interim "Speaking..." entry with the final transcript
        const payload = msg.payload
        console.log('📝 Replacing transcript:', payload);  // Debug log
        context.updateTranscript(payload.replace_id, {
          speaker: payload.speaker === 'hr' ? 'HR' : 'Candidate',
          text: payload.text,
          timestamp: payload.timestamp,
          isFinal: true
        })
      } else if (msg.type === 'suggested_questions') {
        // Batch update questions
        if (msg.questions && Array.isArray(msg.questions)) {
          console.log('💡 Adding questions:', msg.questions);  // Debug log
          context.setSuggestedQuestions(msg.questions)
        }
      } else if (msg.type === 'error') {
        setError(msg.message)
      }
    }
  })

  // 2. Audio Hook - Separate mic (HR) and screen (Candidate) audio
  const micChunkCountRef = React.useRef(0);
  const screenChunkCountRef = React.useRef(0);

  const { startStream, stopStream, isStreaming, isSharing, screenStream, startScreenShare } = useMicrophoneStream({
    onMicAudioData: (base64Data) => {
      const currentState = interviewStateRef.current;

      if (isConnected && currentState === 'RUNNING') {
        sendMessage({ type: 'audio_hr', payload: base64Data })
        micChunkCountRef.current++;
        if (micChunkCountRef.current % 50 === 0) {
          console.log(`🎤 HR audio chunks sent: ${micChunkCountRef.current}`);
        }
      }
    },
    onScreenAudioData: (base64Data) => {
      const currentState = interviewStateRef.current;

      if (isConnected && currentState === 'RUNNING') {
        sendMessage({ type: 'audio_candidate', payload: base64Data })
        screenChunkCountRef.current++;
        if (screenChunkCountRef.current % 50 === 0) {
          console.log(`🖥️ Candidate audio chunks sent: ${screenChunkCountRef.current}`);
        }
      }
    },
    onError: (err) => setError(err)
  })

  // Setup / Cleanup
  useEffect(() => {
    if (!context.isAuthenticated) {
      navigate('/')
    }
  }, [context.isAuthenticated, navigate])

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      disconnect()
      stopStream()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - only run cleanup on unmount

  // --- Handlers ---

  const handleStartInterview = async () => {
    if (!isConnected) {
      setError("WebSocket not connected")
      return
    }

    try {
      // 1. Start Audio (if not already started)
      if (!isStreaming) {
        await startStream()
      }

      // 2. Tell Backend to Start Session with Metadata
      sendMessage({
        type: 'start',
        token: context.token,
        username: context.candidateName,
        mode: context.interviewMode
      })

      // 3. Set state to RUNNING - this enables audio sending
      context.setInterviewState('RUNNING')
      console.log('✅ Interview started, state set to RUNNING')

    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleConfirmEndInterview = () => {
    // 1. Stop Streams
    stopStream()

    // 2. Tell Backend
    sendMessage({ type: 'stop' }) // Optional: tell backend

    // 3. Reset Context State
    context.setInterviewState('COMPLETED')
    context.setToken('') // Clear token in context & localstorage
    context.setCandidateName('')

    // 4. Navigate Away
    navigate('/')
  }

  const handleSelectMeetingRoom = async () => {
    try {
      await startScreenShare()
    } catch (e: any) {
      setError("Failed to share screen: " + e.message)
    }
  }

  const handleStartMic = async () => {
    try {
      await startStream()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleGenerateQuestions = () => {
    sendMessage({ type: 'generate_questions' })
  }

  // --- Render ---

  return (
    <div className="interview-page" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: '#f1f5f9', // Slate-100
      zIndex: 9999, // Ensure it sits on top
      margin: 0,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '60fr 40fr', // Top row takes 60% height
      gap: '12px',
      padding: '12px',
      boxSizing: 'border-box'
    }}>

      {/* 1. TOP LEFT: Meeting Room */}
      <MeetingRoomCard
        isConnected={isConnected}
        isStreaming={isStreaming}
        interviewState={context.interviewState}
        interviewMode={context.interviewMode}
        isSharing={isSharing}
        screenStream={screenStream}
        error={error}
        onStartMic={handleStartMic}
        onStartInterview={handleStartInterview}
        onEndInterview={handleConfirmEndInterview}
        onSelectMeetingRoom={handleSelectMeetingRoom}
      />

      {/* 2. TOP RIGHT: AI Suggestions */}
      <AiQuestionsCard
        questions={context.suggestedQuestions}
        interviewMode={context.interviewMode}
        onGenerateQuestions={handleGenerateQuestions}
      />

      {/* 3. BOTTOM LEFT: Transcript */}
      <TranscriptCard
        transcripts={context.transcripts}
      />

      {/* 4. BOTTOM RIGHT: JD */}
      <JobDescriptionCard />
    </div>
  )
}
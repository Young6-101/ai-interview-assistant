import React, { useEffect, useState } from 'react'
import { useInterview } from '../contexts/InterviewContext'
import { useNavigate } from 'react-router-dom'
import { useWebSocketLite } from '../hooks/useWebSocketLite'
import { useMicrophoneStream } from '../hooks/useMicrophoneStream'
import { MeetingRoomCard } from '../components/interview/MeetingRoomCard'
import { AiQuestionsCard } from '../components/interview/AiQuestionsCard'
import { TranscriptCard } from '../components/interview/TranscriptCard'
import { JobDescriptionCard } from '../components/interview/JobDescriptionCard'

const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Hardcoded JD Content
const jdContent = `Software Engineer (Full Stack)

Requirements:
- 3+ years of experience with React, TypeScript, and Python.
- Strong understanding of WebSocket + Realtime Audio processing.
- Experience with OpenAI API (Realtime / GPT-4o).
- Ability to write clean, maintainable code.
- Familiarity with Cloud deployment (Docker, Nginx, Azure).

Responsibilities:
- Build and maintain the core interview assistant platform.
- optimize audio streaming latency.
- Implement new AI-driven features.`

export const Interview: React.FC = () => {
  const context = useInterview()
  const navigate = useNavigate()
  const [error, setError] = useState<string>('')

  // 1. WebSocket Hook (Lite)
  const { isConnected, sendMessage, disconnect } = useWebSocketLite({
    url: `${VITE_API_URL}/ws`,
    token: context.token || 'temp_token',
    onMessage: (msg: any) => {
      if (msg.type === 'transcript_update') {
        const payload = msg.payload
        context.addTranscript({
          id: `t_${payload.timestamp}`,
          speaker: payload.speaker === 'candidate' ? 'Candidate' : 'HR',
          text: payload.text,
          timestamp: payload.timestamp,
          isFinal: payload.is_final
        })
      } else if (msg.type === 'suggested_questions') {
        // Batch update questions
        if (msg.questions && Array.isArray(msg.questions)) {
          context.setSuggestedQuestions(msg.questions)
        }
      } else if (msg.type === 'error') {
        setError(msg.message)
      }
    }
  })

  // 2. Audio Hook
  const { startStream, stopStream, isStreaming, isSharing, screenStream, startScreenShare } = useMicrophoneStream({
    onAudioData: (base64Data) => {
      // Only send if we are "RUNNING" (User clicked Start Interview)
      // OR... technically we can stream audio even if interview hasn't "started" logically,
      // but usually we want to sync them.
      // However, for "Mic Test" we just want local stream.
      // The backend will only process if session is active.

      if (isConnected && context.interviewState === 'RUNNING') {
        sendMessage({ type: 'audio', payload: base64Data })
      }
    },
    onError: (err) => setError(err)
  })

  // Setup / Cleanup
  useEffect(() => {
    if (!context.isAuthenticated) {
      navigate('/')
    }
    return () => {
      disconnect()
      stopStream()
    }
  }, [context.isAuthenticated, navigate, disconnect, stopStream])

  // --- Handlers ---

  const handleStartInterview = () => {
    if (!isConnected) {
      setError("WebSocket not connected")
      return
    }
    // 1. Start Audio (if not already)
    startStream().then(() => {
      // 2. Tell Backend to Start Session with Metadata
      sendMessage({
        type: 'start',
        token: context.token,
        username: context.candidateName,
        mode: context.interviewMode
      })
      context.setInterviewState('RUNNING')
    }).catch(e => setError(e.message))
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
      <JobDescriptionCard
        content={jdContent}
      />
    </div>
  )
}
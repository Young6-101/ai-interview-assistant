import React, { useState, useEffect, useCallback, type FC, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInterview } from '../contexts/InterviewContext'
import { useWebSocketOptimized } from '../hooks/useWebSocketOptimized'
import { useMeetingRoom } from '../hooks/useMeetingRoom'
import { useAudioCapture, type AudioBlock } from '../hooks/useAudioCapture'
import '../App.css'

// CSS animations for AI warning
const pulseKeyframes = `
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.02); }
  }
`

// Inject styles
if (!document.querySelector('#interview-styles')) {
  const styleSheet = document.createElement('style')
  styleSheet.id = 'interview-styles'
  styleSheet.textContent = pulseKeyframes
  document.head.appendChild(styleSheet)
}

/**
 * ✅ Memoized SuggestedQuestion Item - prevents unnecessary re-renders
 */
const SuggestedQuestionItem = React.memo(
  ({ question }: { question: { id: string; text: string; skill: string } }) => (
    <div style={{ padding: '14px', borderRadius: '16px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
      <p style={{ margin: 0, fontSize: '12px', color: '#475569' }}>{question.skill}</p>
      <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>{question.text}</p>
    </div>
  ),
  (prev, next) => prev.question.id === next.question.id && prev.question.text === next.question.text
)
SuggestedQuestionItem.displayName = 'SuggestedQuestionItem'

export const Interview: FC = () => {
  const navigate = useNavigate()
  const context = useInterview()
  
  /**
   * 1. Initialize custom hooks.
   * Now using the optimized useWebSocketOptimized that handles DOM updates directly
   */
  const { isConnected, connect, startInterview, stopInterview, sendTranscript, requestAnalysis, disconnect, setTranscriptContainer } = useWebSocketOptimized()
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const { screenStream, isSharing, selectMeetingRoom, stopMeetingRoom } = useMeetingRoom()

  /**
   * 2. Stable Context Reference.
   * We use a Ref to store the context object so that handleTranscript can access 
   * state/methods without needing to depend on the context itself. 
   * This prevents infinite re-render loops.
   */
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])

  /**
   * 2.5 Transcript Container Ref - for direct DOM manipulation
   * The optimized WebSocket hook will update transcripts directly in this container
   */
  const transcriptContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTranscriptContainer(transcriptContainerRef.current)
  }, [setTranscriptContainer])

  /**
   * 3. Stable Transcript Handler.
   * This function is passed to useAudioCapture. It must remain stable (same reference) 
   * so the microphone doesn't stop/start every time the component re-renders.
   */
  const handleTranscript = useCallback(
    (block: AudioBlock) => {
      const speakerLabel = block.speaker === 'HR' ? 'HR' : 'CANDIDATE'
      
      // 1. Update Context for global state
      contextRef.current.addTranscript({
        id: block.id,
        speaker: speakerLabel,
        text: block.transcript,
        timestamp: block.timestamp,
        isFinal: true
      })
      
      // 2. Forward to backend via WebSocket
      // The backend will broadcast it back, and useWebSocketOptimized 
      // will handle DOM updates via broadcast_update
      sendTranscript(speakerLabel, block.transcript, block.timestamp)
    },
    [sendTranscript]
  )

  /**
   * 4. Initialize Audio Capture logic.
   */
  const { 
    startHrRecording, 
    stopHrRecording, 
    startCandidateRecording, 
    stopCandidateRecording, 
    setAssemblyAIToken 
  } = useAudioCapture(handleTranscript)

  // 5. Local UI States
  const [error, setError] = useState('')
  const [hrMicOn, setHrMicOn] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [showAIWarning, setShowAIWarning] = useState(false)
  
  const storedMode = localStorage.getItem('interview_mode') ?? 'mode1'
  
  // AI Warning visibility logic based on mode
  useEffect(() => {
    if (storedMode === 'mode3') {
      setShowAIWarning(true)
    } else {
      setShowAIWarning(false)
    }
  }, [storedMode])

  // ============ LIFECYCLE EFFECTS ============

  /**
   * A. Establish WebSocket Connection.
   * Connect only once when the component mounts. 
   * Clean up (disconnect) when leaving the page.
   */
  useEffect(() => {
    console.log('Interview component mounted - Triggering WebSocket connection')
    connect()
    return () => {
        // Only disconnect if the component is actually unmounting
        disconnect()
    }
  }, [connect, disconnect])

  /**
   * B. Auth Guard.
   * Redirect to login if user session is missing.
   */
  useEffect(() => {
    if (!localStorage.getItem('candidate_name')) {
      navigate('/login')
    }
  }, [navigate])

  /**
   * C. Fetch AssemblyAI Configuration on Demand
   */
  const fetchAssemblyAIConfig = useCallback(async (): Promise<string | null> => {
    try {
      const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
      const response = await fetch(`${API_BASE_URL}/api/config/assemblyai`)
      if (!response.ok) {
        throw new Error(`Failed to fetch AssemblyAI config: ${response.status}`)
      }
      const data = await response.json()
      
      // Try to use token first, fall back to API key
      const token = data.token || data.apiKey
      if (!token) {
        throw new Error('AssemblyAI configuration not available on server')
      }
      console.log('✅ AssemblyAI config fetched from backend')
      return token
    } catch (err) {
      console.error('Failed to fetch AssemblyAI config:', err)
      throw err
    }
  }, [])

  /**
   * D. Fetch AssemblyAI Token on Component Mount
   * Get the token early so audio capture is ready immediately
   */
  useEffect(() => {
    const initAssemblyAI = async () => {
      try {
        const token = await fetchAssemblyAIConfig()
        if (token) {
          setAssemblyAIToken(token)
        }
      } catch (err) {
        console.error('Failed to initialize AssemblyAI on mount:', err)
      }
    }
    initAssemblyAI()
  }, [fetchAssemblyAIConfig, setAssemblyAIToken])

  /**
   * E. Candidate Recording Sync.
   * Automatically starts the candidate's mic capture when a screen stream is shared.
   */
  useEffect(() => {
    if (!screenStream) {
      stopCandidateRecording()
      return
    }

    startCandidateRecording(screenStream)
      .catch((err) => {
        console.error('Candidate capture failed:', err)
        setError('Candidate mic failed: ' + (err?.message ?? 'Unknown'))
      })

    return () => {
      stopCandidateRecording()
    }
  }, [screenStream, startCandidateRecording, stopCandidateRecording])

  /**
   * E. Manual Stream End Detection.
   * Detects if the user clicks "Stop Sharing" on the browser's system bar.
   */
  useEffect(() => {
    if (!screenStream) return
    const videoTrack = screenStream.getVideoTracks()[0]
    if (!videoTrack) return

    const onEnded = () => {
      console.log('Screen sharing ended via browser UI')
      stopMeetingRoom()
    }
    videoTrack.addEventListener('ended', onEnded)
    return () => videoTrack.removeEventListener('ended', onEnded)
  }, [screenStream, stopMeetingRoom])

  // ============ EVENT HANDLERS ============

  /**
   * Triggers the "start" message to the backend via WebSocket.
   * Validates prerequisites (HR mic and meeting room are ready).
   */
  const handleStartInterview = () => {
    // Validation checks
    if (!isConnected) {
      setError('⚠️ Waiting for WebSocket connection...')
      return
    }
    if (!isSharing) {
      setError('⚠️ Please select a meeting room first')
      return
    }
    if (!hrMicOn) {
      setError('⚠️ Please turn on the HR microphone')
      return
    }

    // All prerequisites met - start interview
    setIsStarting(true)
    setError('')
    try {
      if (startInterview()) {
        context.setInterviewState('RUNNING')
        setError('')
      }
    } catch (err) {
      setError('❌ Failed to start interview: ' + (err as Error).message)
    } finally {
      setIsStarting(false)
    }
  }

  /**
   * Opens the browser's screen picker UI.
   */
  const handleSelectMeetingRoom = async () => {
    setIsSelecting(true)
    setError('')
    try {
      await selectMeetingRoom()
    } catch (err: any) {
      setError(err?.message || 'Failed to select room')
    } finally {
      setIsSelecting(false)
    }
  }

  const handleStartHrMic = async () => {
    try {
      await startHrRecording()
      setHrMicOn(true)
    } catch (err: any) {
      setError(err?.message || 'HR mic failed')
    }
  }

  const handleStopHrMic = () => {
    stopHrRecording()
    setHrMicOn(false)
  }

  /**
   * Request AI analysis manually
   */
  const handleRequestAnalysis = async () => {
    if (!isConnected || context.interviewState !== 'RUNNING') {
      setError('⚠️ Interview must be running to analyze')
      return
    }
    
    setIsAnalyzing(true)
    
    // Mode-based AI warning logic
    if (storedMode === 'mode2') {
      setShowAIWarning(true)
      // Hide after 10 seconds
      setTimeout(() => setShowAIWarning(false), 10000)
    }
    
    try {
      requestAnalysis()
      // 按钮会在收到响应后自动恢复
      setTimeout(() => setIsAnalyzing(false), 3000)
    } catch (err) {
      setError('❌ Analysis request failed')
      setIsAnalyzing(false)
    }
  }

  /**
   * Handles re-selection of the meeting room.
   * It explicitly stops existing tracks before requesting a new one 
   * to prevent hardware/permission conflicts.
   */
  const handleReselectMeetingRoom = async () => {
    setError('')
    try {
        // 1. Explicitly stop current tracks to free up the hardware
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop())
        }
        
        // 2. Reset states and stop internal audio logic
        stopCandidateRecording()
        stopMeetingRoom() // Resets the context stream to null
        
        // 3. Small delay to allow the browser to process the hardware release
        await new Promise(resolve => setTimeout(resolve, 150))
        
        // 4. Trigger the selection dialog again
        await handleSelectMeetingRoom()
    } catch (err: any) {
        console.error('Reselect failed:', err)
        setError(err?.message || 'Failed to reselect meeting room')
    }
  }

  const handleStopInterview = () => {
    if (stopInterview()) {
      context.setInterviewState('ENDED')
      // Stop all audio capture
      stopHrRecording()
      stopCandidateRecording()
      stopMeetingRoom()
      // Reset mic states
      setHrMicOn(false)
      setError('')
    }
  }

  const handleLogout = () => {
    disconnect()
    localStorage.clear()
    navigate('/login')
  }

  // 只需要：HR麦克风 + 屏幕共享都打开（Candidate会自动跟随Screen sharing）
  const canStartInterview = isSharing && hrMicOn

  // ============ RENDER (JSX) ============
  return (
    <div style={{ 
      position: 'fixed',           // ✅ 固定定位，填充整个屏幕
      top: 0,                      // ✅ 从屏幕顶部开始
      left: 0,                     // ✅ 从屏幕左侧开始
      width: '100vw',              // ✅ 填充整个宽度
      height: '100vh',             // ✅ 填充整个高度
      background: 'linear-gradient(180deg, #0f172a, #1f2a44)', 
      color: '#0f172a', 
      display: 'flex', 
      flexDirection: 'column',
      overflow: 'hidden'           // ✅ 固定页面，禁止滚动
    }}>
      <div style={{ 
        height: '100vh',           // ✅ 固定高度填充视窗
        display: 'flex', 
        flexDirection: 'column',
        width: '100%'              // ✅ 确保宽度填满
      }}>
        <header style={{ 
          padding: '20px 32px', 
          borderBottom: '1px solid rgba(248,250,252,0.1)',
          width: '100%',             // ✅ 确保header宽度填满
          boxSizing: 'border-box'    // ✅ 包含padding在宽度内
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '14px', color: '#cbd5f5' }}>{storedMode === 'mode1' ? 'Guided' : storedMode === 'mode2' ? 'Open Q&A' : 'Expert'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              {/* Status indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '999px', backgroundColor: isConnected ? '#4ade80' : '#f87171' }} />
                <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{isConnected ? 'Connected' : 'Waiting...'}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(248,250,252,0.3)', background: 'rgba(248,250,252,0.05)', color: '#cbd5f5', fontSize: '13px', cursor: 'pointer' }}
            >
              Logout
            </button>
          </div>
        </header>

        {error && (
          <div style={{ margin: '16px 32px 0', padding: '12px 16px', borderRadius: '12px', backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', fontSize: '13px' }}>
            {error}
          </div>
        )}
        
        {/* AI Warning Banner */}
        {showAIWarning && (
          <div style={{
            margin: '16px 32px 0',
            padding: '16px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
            color: '#92400e',
            fontSize: '14px',
            fontWeight: 600,
            textAlign: 'center',
            border: '2px solid #fcd34d',
            boxShadow: '0 4px 12px rgba(251, 191, 36, 0.3)',
            animation: storedMode === 'mode2' ? 'pulse 2s ease-in-out infinite' : 'none'
          }}>
            ⚠️ CANDIDATE KNOWS YOU ARE USING AI NOW
          </div>
        )}

        <main style={{ 
          flex: 1, 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr',  
          gap: '24px', 
          padding: '24px 32px', 
          height: 'calc(100vh - 120px)',   
          width: '100%',           
          boxSizing: 'border-box',  
          overflow: 'hidden'       
        }}>
          <section style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '20px', 
            height: '100%',          // ✅ 填满高度
            overflow: 'hidden'       // ✅ section不滚动
          }}>
            <div style={{ 
              backgroundColor: 'white', 
              borderRadius: '16px', 
              padding: '20px', 
              boxShadow: '0 25px 60px rgba(15,23,42,0.45)', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '16px', 
              height: '100%',        // ✅ 填满section高度
              overflow: 'hidden'     // ✅ 主box不滚动
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    onClick={hrMicOn ? handleStopHrMic : handleStartHrMic}
                    style={{ padding: '10px 16px', borderRadius: '12px', border: 'none', backgroundColor: hrMicOn ? '#dc2626' : '#10b981', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {hrMicOn ? 'Stop HR Mic' : 'Start HR Mic'}
                  </button>
                  {context.interviewState === 'NOT_STARTED' && (
                    <button
                      onClick={handleStartInterview}
                      disabled={!canStartInterview || isStarting}
                      style={{ padding: '10px 16px', borderRadius: '12px', border: 'none', backgroundColor: canStartInterview && !isStarting ? '#2563eb' : '#cbd5f5', color: '#fff', fontWeight: 600, cursor: canStartInterview && !isStarting ? 'pointer' : 'not-allowed' }}
                    >
                      {isStarting ? 'Starting...' : 'Start Interview'}
                    </button>
                  )}
                  {context.interviewState === 'RUNNING' && (
                    <button
                      onClick={handleStopInterview}
                      style={{ padding: '10px 16px', borderRadius: '12px', border: 'none', backgroundColor: '#ef4444', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                    >
                      End Interview
                    </button>
                  )}
                </div>
              </div>
              
              <div style={{ 
                borderRadius: '16px', 
                overflow: 'hidden', 
                position: 'relative', 
                flex: 1,               // ✅ 占用可用空间
                backgroundColor: '#0f172a', 
                minHeight: '200px'     // ✅ 最小高度
              }}>
                {isSharing && screenStream ? (
                  <div style={{ width: '100%', height: '100%' }}>
                    <video
                      className='meeting-room-video'
                      ref={(el) => { if (el && el.srcObject !== screenStream) el.srcObject = screenStream }}
                      autoPlay
                      muted
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', top: '12px', left: '12px', padding: '6px 10px', borderRadius: '999px', backgroundColor: 'rgba(15,23,42,0.8)', color: '#f8fafc', fontSize: '12px', fontWeight: 600 }}>
                      SHARING
                    </div>
                    <div style={{ position: 'absolute', bottom: '12px', right: '12px', display: 'flex', gap: '8px' }}>
                      <button
                        onClick={stopMeetingRoom}
                        style={{ padding: '8px 12px', borderRadius: '10px', border: 'none', backgroundColor: '#ef4444', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Stop
                      </button>
                      <button
                        onClick={handleReselectMeetingRoom}
                        style={{ padding: '8px 12px', borderRadius: '10px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Reselect
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '32px', textAlign: 'center', color: '#f8fafc' }}>
                    <p style={{ marginBottom: '16px', fontSize: '18px' }}>Ready when you are</p>
                    <button
                      onClick={handleSelectMeetingRoom}
                      disabled={isSelecting}
                      style={{ padding: '12px 20px', borderRadius: '12px', border: 'none', backgroundColor: '#2563eb', color: '#fff', fontWeight: 600, cursor: isSelecting ? 'not-allowed' : 'pointer' }}
                    >
                      {isSelecting ? 'Selecting...' : 'Choose meeting room'}
                    </button>
                  </div>
                )}
              </div>
              
              {/* Transcript Area */}
              <div style={{ 
                backgroundColor: 'white', 
                borderRadius: '16px', 
                padding: '20px', 
                boxShadow: '0 25px 60px rgba(15,23,42,0.2)', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '12px', 
                flex: 1,               // ✅ 占用可用空间
                minHeight: '200px',    // ✅ 最小高度
                overflow: 'hidden'     // ✅ container不滚动
              }}>
                <h3 style={{ margin: 0, fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>Transcript</h3>
                <div 
                  ref={transcriptContainerRef}
                  style={{ 
                    flex: 1, 
                    overflowY: 'auto',        // ✅ 内容区域可滚动
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '2px', 
                    padding: '8px', 
                    backgroundColor: '#f8fafc', 
                    borderRadius: '8px', 
                    border: '1px solid #e2e8f0' 
                  }}
                >
                  {/* Will be populated by DOM directly */}
                </div>
              </div>
            </div>
          </section>

          {/* Suggestions Sidebar */}
          <aside style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            padding: '20px', 
            boxShadow: '0 25px 60px rgba(15,23,42,0.25)', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '12px', 
            height: '100%',          // ✅ 填满grid高度
            overflow: 'hidden'       // ✅ aside不滚动
          }}>
            {/* Title always visible */}
            <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a', fontWeight: 700 }}>Follow-up Questions</h3>
            
            {/* AI Analyze Button */}
            <button
              onClick={handleRequestAnalysis}
              disabled={!isConnected || context.interviewState !== 'RUNNING' || isAnalyzing}
              style={{
                padding: '10px 16px',
                borderRadius: '12px',
                border: 'none',
                background: isAnalyzing 
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' 
                  : context.interviewState === 'RUNNING' 
                    ? 'linear-gradient(135deg, #8b5cf6, #a855f7)' 
                    : '#e2e8f0',
                color: context.interviewState === 'RUNNING' ? '#fff' : '#94a3b8',
                fontWeight: 600,
                fontSize: '14px',
                cursor: context.interviewState === 'RUNNING' && !isAnalyzing ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s ease',
                width: '100%'
              }}
            >
              {isAnalyzing ? (
                <>
                  <span style={{ animation: 'spin 1s linear infinite' }}>⏳</span>
                  Analyzing...
                </>
              ) : (
                <>
                  🤖 Generate Questions
                </>
              )}
            </button>
            
            {/* Questions List */}
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '10px', 
              overflowY: 'auto',       // ✅ 问题列表可滚动
              minHeight: 0 
            }}>
              {context.suggestedQuestions.length === 0 ? (
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Click the button above to generate questions</p>
              ) : (
                context.suggestedQuestions.map((q) => (
                  <SuggestedQuestionItem key={q.id} question={q} />
                ))
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  )
}
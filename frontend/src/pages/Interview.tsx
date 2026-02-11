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
  const { isConnected, connect, startInterview, stopInterview, sendTranscript, sendPartialTranscript, requestAnalysis, disconnect, setTranscriptContainer } = useWebSocketOptimized()
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
   * 3. Stable Transcript Handler (Final transcripts).
   * This function is passed to useAudioCapture. It must remain stable (same reference) 
   * so the microphone doesn't stop/start every time the component re-renders.
   */
  const handleTranscript = useCallback(
    (block: AudioBlock) => {
      // 1. Update Context for global state (keep original speaker value)
      contextRef.current.addTranscript({
        id: block.id,
        speaker: block.speaker,
        text: block.transcript,
        timestamp: block.timestamp,
        isFinal: true
      })

      // 2. Forward to backend via WebSocket
      // The backend will broadcast it back, and useWebSocketOptimized 
      // will handle DOM updates via broadcast_update
      sendTranscript(block.speaker, block.transcript, block.timestamp)
    },
    [sendTranscript]
  )

  /**
   * 3.5 Partial Transcript Handler (Real-time updates).
   * Updates DOM directly for instant feedback while user is speaking.
   */
  const handlePartialTranscript = useCallback(
    (partial: { id: string; speaker: 'HR' | 'CANDIDATE'; text: string; timestamp: number }) => {
      // Update DOM directly for real-time display
      sendPartialTranscript(partial.id, partial.speaker, partial.text, partial.timestamp)
    },
    [sendPartialTranscript]
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
  } = useAudioCapture(handleTranscript, handlePartialTranscript)

  // 5. Local UI States
  const [error, setError] = useState('')
  const [hrMicOn, setHrMicOn] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [showAIWarning, setShowAIWarning] = useState(false)
  const [showEndConfirmPopup, setShowEndConfirmPopup] = useState(false)

  const storedMode = context.interviewMode

  // AI Warning visibility logic based on mode
  // Mode 3: always show warning
  useEffect(() => {
    if (storedMode === 'mode3') {
      setShowAIWarning(true)
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
    // Check context for candidate name (memory only)
    if (!context.candidateName) {
      navigate('/login')
    }
  }, [context.candidateName, navigate])

  /**
   * C. Fetch AssemblyAI Configuration on Demand
   */
  const fetchAssemblyAIConfig = useCallback(async (): Promise<string | null> => {
    try {
      // Use relative path - rely on Nginx proxy
      const API_BASE_URL = ''
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

    // 清空之前的问题列表，准备生成新内容
    context.clearSuggestedQuestions()

    // Mode-based AI warning logic
    if (storedMode === 'mode2') {
      setShowAIWarning(true)
      // Hide after 10 seconds
      setTimeout(() => setShowAIWarning(false), 5000)
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

  // Show confirmation popup when clicking End Interview
  const handleEndInterviewClick = () => {
    setShowEndConfirmPopup(true)
  }

  // Actually stop the interview after confirmation
  const handleConfirmEndInterview = () => {
    if (stopInterview()) {
      context.setInterviewState('ENDED')
      // Stop all audio capture
      stopHrRecording()
      stopCandidateRecording()
      stopMeetingRoom()
      // Reset mic states
      setHrMicOn(false)
      setError('')
      setShowEndConfirmPopup(false)
      // Navigate to login page after a brief delay to allow JSON generation
      setTimeout(() => {
        localStorage.clear()
        navigate('/login')
      }, 500)
    }
  }

  // Cancel ending the interview
  const handleCancelEndInterview = () => {
    setShowEndConfirmPopup(false)
  }

  const handleLogout = () => {
    disconnect()
    // LocalStorage clearing is optional now since we rely on memory, 
    // but good for cleaning up potential old data
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
        flexDirection: 'row',      // ✅ 改为水平布局
        width: '100%'              // ✅ 确保宽度填满
      }}>
        {/* 左侧面板 - 视频和转录 */}
        <div style={{
          width: '50%',               // 左边一半宽度
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          backgroundColor: 'white'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            margin: '20px',
            padding: '20px',
            boxShadow: '0 25px 60px rgba(15,23,42,0.45)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            height: 'calc(50vh - 40px)',        // 上半部分
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={hrMicOn ? handleStopHrMic : handleStartHrMic}
                  style={{ padding: '10px 16px', borderRadius: '12px', border: 'none', backgroundColor: hrMicOn ? '#dc2626' : '#10b981', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                >
                  {hrMicOn ? 'Stop Your Mic' : 'Start Your Mic'}
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
                    onClick={handleEndInterviewClick}
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
              flex: 1,
              backgroundColor: '#0f172a',
              minHeight: '200px'
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
                </div>
              ) : (
                <div style={{
                  padding: '32px',
                  textAlign: 'center',
                  color: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%'
                }}>
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
          </div>

          {/* Transcript Area */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            margin: '20px',
            padding: '20px',
            boxShadow: '0 25px 60px rgba(15,23,42,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            height: 'calc(50vh - 40px)',    // 下半部分
            overflow: 'hidden'
          }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>Transcript</h3>
            <div
              ref={transcriptContainerRef}
              style={{
                flex: 1,
                overflowY: 'auto',
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

        {/* 右侧面板 - Header、AI警告和问题 */}
        <div style={{
          width: '50%',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: 'linear-gradient(180deg, #0f172a, #1f2a44)',
          position: 'relative'
        }}>
          {/* Header信息 */}
          <header style={{
            padding: '20px 32px',
            borderBottom: '1px solid rgba(248,250,252,0.1)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ fontSize: '14px', color: '#cbd5f5' }}>{storedMode === 'mode1' ? 'Mode 1' : storedMode === 'mode2' ? 'Mode 2' : 'Mode 3'}</span>
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

          {/* Suggestions Sidebar */}
          <aside style={{
            position: 'absolute',
            top: '80px',
            left: '32px',
            right: '32px',
            bottom: '20px',
            height: 'auto',
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 25px 60px rgba(15,23,42,0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            overflow: 'hidden'
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

            {/* AI Warning Banner - Always rendered to maintain layout */}
            <div style={{
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              color: '#92400e',
              fontSize: '13px',
              fontWeight: 600,
              textAlign: 'center',
              border: '2px solid #fcd34d',
              boxShadow: '0 4px 12px rgba(251, 191, 36, 0.3)',
              animation: storedMode === 'mode2' ? 'pulse 5s ease-in-out infinite' : 'none',
              opacity: showAIWarning ? 1 : 0,
              visibility: showAIWarning ? 'visible' : 'hidden',
              transition: 'opacity 0.3s ease, visibility 0.3s ease'

            }}>
              <div>⚠️ CANDIDATE KNOWS YOU ARE USING AI NOW</div>
              {storedMode === 'mode2' && (
                <div style={{ fontSize: '11px', marginTop: '6px', opacity: 0.85 }}>(This message will automatically disappear in 5 seconds)</div>
              )}
            </div>

            {/* Questions List */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              overflowY: 'auto',
              minHeight: 0
            }}>
              {context.suggestedQuestions.length === 0 ? null : (
                context.suggestedQuestions.map((q) => (
                  <SuggestedQuestionItem key={q.id} question={q} />
                ))
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* End Interview Confirmation Popup */}
      {showEndConfirmPopup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '20px',
            padding: '40px 50px',
            textAlign: 'center',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.3)',
            maxWidth: '400px',
            width: '90%'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
            <h2 style={{
              margin: '0 0 12px',
              fontSize: '24px',
              color: '#0f172a',
              fontWeight: 700
            }}>
              Thank you for your cooperation!
            </h2>
            <p style={{
              margin: '0 0 28px',
              fontSize: '14px',
              color: '#64748b'
            }}>
              Are you sure you want to end the interview? This will save the session data.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={handleCancelEndInterview}
                style={{
                  padding: '12px 24px',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#f8fafc',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEndInterview}
                style={{
                  padding: '12px 24px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                Confirm & End
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
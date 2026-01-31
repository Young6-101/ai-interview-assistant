import { useState, useEffect, useCallback, type FC, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInterview } from '../contexts/InterviewContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { useMeetingRoom } from '../hooks/useMeetingRoom'
import { useAudioCapture, type AudioBlock } from '../hooks/useAudioCapture'
import '../App.css'

const MODE_LABELS: Record<string, string> = {
  mode1: 'Mode 1 · Guided',
  mode2: 'Mode 2 · Open Q&A',
  mode3: 'Mode 3 · Expert'
}

export const Interview: FC = () => {
  const navigate = useNavigate()
  const context = useInterview()
  
  /**
   * 1. Initialize custom hooks.
   * Make sure useWebSocket is the refactored version that provides 'connect'.
   */
  const { isConnected, connect, startInterview, stopInterview, sendTranscript, disconnect } = useWebSocket()
  const { screenStream, isSharing, selectMeetingRoom, stopMeetingRoom, error: meetingRoomError } = useMeetingRoom()

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
   * 3. Stable Transcript Handler.
   * This function is passed to useAudioCapture. It must remain stable (same reference) 
   * so the microphone doesn't stop/start every time the component re-renders.
   */
  const handleTranscript = useCallback(
    (block: AudioBlock) => {
      const speakerLabel = block.speaker === 'HR' ? 'HR' : 'CANDIDATE'
      
      // Update UI state via Context Ref
      contextRef.current.addTranscript({
        id: block.id,
        speaker: speakerLabel,
        text: block.transcript,
        timestamp: block.timestamp,
        isFinal: true
      })
      
      // Forward the text to the backend via WebSocket
      sendTranscript(speakerLabel, block.transcript, block.timestamp)
    },
    [sendTranscript] // Only depends on sendTranscript, which is stable
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
  const [candidateMicOn, setCandidateMicOn] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  
  const assemblyToken = import.meta.env.VITE_ASSEMBLY_API_KEY ?? ''
  const storedMode = localStorage.getItem('interview_mode') ?? 'mode1'
  const candidateName = localStorage.getItem('candidate_name') ?? 'Candidate'
  const modeLabel = MODE_LABELS[storedMode] || storedMode

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
   * C. AssemblyAI Configuration.
   * Set the API token for the audio processing hook.
   */
  useEffect(() => {
    if (assemblyToken) {
      setAssemblyAIToken(assemblyToken)
      if (error === 'Missing API Key') setError('')
    } else {
      setError('Missing API Key')
    }
  }, [assemblyToken, setAssemblyAIToken])

  /**
   * D. Candidate Recording Sync.
   * Automatically starts the candidate's mic capture when a screen stream is shared.
   */
  useEffect(() => {
    if (!screenStream) {
      stopCandidateRecording()
      setCandidateMicOn(false)
      return
    }

    startCandidateRecording(screenStream)
      .then(() => setCandidateMicOn(true))
      .catch((err) => {
        console.error('Candidate capture failed:', err)
        setError('Candidate mic failed: ' + (err?.message ?? 'Unknown'))
      })

    return () => {
      stopCandidateRecording()
      setCandidateMicOn(false)
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
   */
  const handleStartInterview = () => {
    if (!isConnected) return setError('Waiting for WebSocket connection...')
    if (!isSharing) return setError('Please select a meeting room first')
    if (!hrMicOn || !candidateMicOn) return setError('Ensure both HR and Candidate mics are active')

    if (startInterview()) {
      context.setInterviewState('RUNNING')
      setError('')
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
        setCandidateMicOn(false)
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
      stopHrRecording()
      stopCandidateRecording()
      stopMeetingRoom()
    }
  }

  const handleLogout = () => {
    disconnect()
    localStorage.clear()
    navigate('/login')
  }

  const canStartInterview = isSharing && hrMicOn

  // ============ RENDER (JSX) ============
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0f172a, #1f2a44)', color: '#0f172a' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '32px 0' }}>
        <header style={{ padding: '0 32px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: 0, letterSpacing: '0.3em', textTransform: 'uppercase', fontSize: '12px', color: '#94a3b8' }}>Live interview</p>
              <h1 style={{ margin: '6px 0 0', fontSize: '36px', color: '#f8fafc' }}>{candidateName}</h1>
              <p style={{ margin: '4px 0 0', fontSize: '16px', color: '#cbd5f5' }}>Mode: {modeLabel}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '14px', color: '#e2e8f0' }}>Status:</span>
                <span style={{ width: '10px', height: '10px', borderRadius: '999px', backgroundColor: isConnected ? '#4ade80' : '#f87171', display: 'inline-block' }} />
                <span style={{ color: '#e2e8f0', fontSize: '14px' }}>{isConnected ? 'Connected' : 'Connecting...'}</span>
              </div>
              <button
                onClick={handleLogout}
                style={{ padding: '8px 18px', borderRadius: '999px', border: '1px solid rgba(248,250,252,0.5)', background: 'rgba(248,250,252,0.15)', color: '#f8fafc', cursor: 'pointer' }}
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div style={{ margin: '0 32px 20px', padding: '12px 16px', borderRadius: '12px', backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        <main style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '24px', padding: '0 32px 32px' }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ backgroundColor: 'white', borderRadius: '28px', padding: '26px', boxShadow: '0 25px 60px rgba(15,23,42,0.45)', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#94a3b8' }}>Meeting Room</p>
                  <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#475569' }}>
                    {isSharing ? 'Screen sharing in progress' : 'Select a meeting room to get started'}
                  </p>
                </div>
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
                      disabled={!canStartInterview}
                      style={{ padding: '10px 16px', borderRadius: '12px', border: 'none', backgroundColor: canStartInterview ? '#2563eb' : '#cbd5f5', color: '#fff', fontWeight: 600, cursor: canStartInterview ? 'pointer' : 'not-allowed' }}
                    >
                      Start Interview
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
              
              <div style={{ borderRadius: '18px', overflow: 'hidden', position: 'relative', minHeight: '240px', backgroundColor: '#0f172a' }}>
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
            </div>
            
            {/* Transcript Area */}
            <div style={{ backgroundColor: 'white', borderRadius: '24px', padding: '22px', boxShadow: '0 25px 60px rgba(15,23,42,0.2)' }}>
              <div style={{ marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>Transcript</h3>
                <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#6b7280' }}>Live captions streamed from AssemblyAI</p>
              </div>
              <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {context.transcripts.length === 0 ? (
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>Waiting for first transcript...</p>
                ) : (
                  context.transcripts.map((t) => (
                    <div key={t.id} style={{ padding: '12px', borderRadius: '12px', backgroundColor: t.speaker === 'HR' ? '#eff6ff' : '#f0fdf4', borderLeft: `3px solid ${t.speaker === 'HR' ? '#3b82f6' : '#10b981'}` }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: t.speaker === 'HR' ? '#1d4ed8' : '#047857' }}>[{t.speaker}]</span>
                      <p style={{ margin: '6px 0 4px', fontSize: '13px' }}>{t.text}</p>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(t.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Suggestions Sidebar */}
          <aside style={{ backgroundColor: 'white', borderRadius: '28px', padding: '24px', boxShadow: '0 25px 60px rgba(15,23,42,0.25)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: 0, fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#94a3b8' }}>Coaching cue</p>
              <h3 style={{ margin: '6px 0 0', fontSize: '18px', color: '#0f172a' }}>Follow-up questions</h3>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto' }}>
              {context.suggestedQuestions.length === 0 ? (
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>Generating follow-up suggestions...</p>
              ) : (
                context.suggestedQuestions.map((q) => (
                  <div key={q.id} style={{ padding: '14px', borderRadius: '16px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: '#475569' }}>{q.skill}</p>
                    <p style={{ margin: '6px 0 0', fontSize: '14px', color: '#0f172a', fontWeight: 600 }}>{q.text}</p>
                  </div>
                ))
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  )
}
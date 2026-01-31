import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInterview } from '../contexts/InterviewContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { useMeetingRoom } from '../hooks/useMeetingRoom'
import { useAudioCapture } from '../hooks/useAudioCapture'
import '../App.css'

const MODE_LABELS: Record<string, string> = {
  mode1: 'Mode 1 · Guided',
  mode2: 'Mode 2 · Open Q&A',
  mode3: 'Mode 3 · Expert'
}

interface InterviewSetup {
  candidateName: string
  position: string
  duration: number
}

export const Interview: React.FC = () => {
  const navigate = useNavigate()
  const context = useInterview()
  const { isConnected, startInterview, pauseInterview, stopInterview, sendTranscript, disconnect } = useWebSocket()
  const { screenStream, isSharing, selectMeetingRoom, stopMeetingRoom, error: meetingRoomError } = useMeetingRoom()
  const handleTranscript = useCallback(
    (block) => {
      const speakerLabel = block.speaker === 'HR' ? 'HR' : 'CANDIDATE'
      context.addTranscript({
        id: block.id,
        speaker: speakerLabel,
        text: block.transcript,
        timestamp: block.timestamp,
        isFinal: true
      })
      sendTranscript(speakerLabel, block.transcript, block.timestamp)
    },
    [context, sendTranscript]
  )
  const { startHrRecording, stopHrRecording, startCandidateRecording, stopCandidateRecording, setAssemblyAIToken } = useAudioCapture(handleTranscript)

  const storedCandidateName = localStorage.getItem('candidate_name') ?? ''
  const storedMode = localStorage.getItem('interview_mode') ?? 'mode1'
  const [setup, setSetup] = useState<InterviewSetup>({
    candidateName: storedCandidateName,
    position: 'Software Engineer',
    duration: 60
  })
  const modeLabel = MODE_LABELS[storedMode] || storedMode
  const [setupComplete, setSetupComplete] = useState(false)
  const [error, setError] = useState('')
  const assemblyToken = import.meta.env.VITE_ASSEMBLYAI_API_KEY ?? import.meta.env.VITE_ASSEMBLY_API_KEY ?? ''

  // Check authentication
  useEffect(() => {
    const registeredName = localStorage.getItem('candidate_name')
    if (!registeredName) {
      navigate('/login')
    }
  }, [navigate])

  useEffect(() => {
    if (assemblyToken) {
      setAssemblyAIToken(assemblyToken)
      setError('')
    } else if (setupComplete) {
      setError('AssemblyAI API key is missing. Please set VITE_ASSEMBLYAI_API_KEY.')
    }
  }, [assemblyToken, setAssemblyAIToken, setupComplete])

  const handleStartSetup = () => {
    if (!setup.candidateName.trim()) {
      setError('Please enter candidate name')
      return
    }
    setError('')
    setSetupComplete(true)
  }

  useEffect(() => {
    if (!screenStream) {
      stopCandidateRecording()
      return
    }

    startCandidateRecording(screenStream).catch((err) => {
      console.error('Candidate audio capture failed', err)
      setError('Candidate audio capture failed: ' + (err?.message ?? 'Unknown error'))
    })

    return () => {
      stopCandidateRecording()
    }
  }, [screenStream, startCandidateRecording, stopCandidateRecording])

  const handleStartInterview = () => {
    if (!isConnected) {
      setError('WebSocket not connected. Please wait...')
      return
    }

    if (!isSharing) {
      setError('Please select meeting room first')
      return
    }

    if (!hrMicOn || !candidateMicOn) {
      setError('Please start both HR and Candidate mics before starting the interview')
      return
    }

    if (startInterview()) {
      context.setInterviewState('RUNNING')
      setError('')
    } else {
      setError('Failed to start interview')
    }
  }

  const handlePauseInterview = () => {
    if (pauseInterview()) {
      context.setInterviewState('PAUSED')
    }
  }

  const handleSelectMeetingRoom = async () => {
    setIsSelecting(true)
    setError('')
    try {
      await selectMeetingRoom()
    } catch (err: any) {
      console.error('Select meeting room failed', err)
      setError(err?.message || 'Failed to select meeting room')
    } finally {
      setIsSelecting(false)
    }
  }

  const handleStartHrMic = async () => {
    setError('')
    try {
      await startHrRecording()
      setHrMicOn(true)
    } catch (err: any) {
      console.error('Failed to start HR mic', err)
      setError(err?.message || 'Failed to start HR mic')
    }
  }

  const handleStopHrMic = () => {
    try {
      stopHrRecording()
    } catch (err) {
      console.error('Failed to stop HR mic', err)
    }
    setHrMicOn(false)
  }

  const handleStartCandidateMic = async () => {
    setError('')
    if (!screenStream) {
      setError('Please select meeting room (screen) first')
      return
    }
    try {
      await startCandidateRecording(screenStream)
      setCandidateMicOn(true)
    } catch (err: any) {
      console.error('Failed to start candidate mic', err)
      setError(err?.message || 'Failed to start candidate mic')
    }
  }

  const handleStopCandidateMic = () => {
    try {
      stopCandidateRecording()
    } catch (err) {
      console.error('Failed to stop candidate mic', err)
    }
    setCandidateMicOn(false)
  }

  const handleReselectMeetingRoom = async () => {
    try {
      stopMeetingRoom()
      await handleSelectMeetingRoom()
    } catch (err: any) {
      console.error('Reselect meeting room failed', err)
      setError(err?.message || 'Failed to reselect meeting room')
    }
  }

  // If the screen stream's video track ends, ensure UI/cleanup runs
  useEffect(() => {
    if (!screenStream) return
    const videoTrack = screenStream.getVideoTracks()[0]
    if (!videoTrack) return
    const onEnded = () => {
      console.log('Screen sharing ended (detected in Interview.tsx)')
      stopMeetingRoom()
    }
    videoTrack.addEventListener('ended', onEnded)
    return () => {
      try {
        videoTrack.removeEventListener('ended', onEnded)
      } catch (_err) {}
    }
  }, [screenStream, stopMeetingRoom])

  // If sharing stops, ensure candidate mic is stopped
  useEffect(() => {
    if (!isSharing && candidateMicOn) {
      try {
        stopCandidateRecording()
      } catch (err) {}
      setCandidateMicOn(false)
    }
  }, [isSharing, candidateMicOn, stopCandidateRecording])

  const handleStopInterview = () => {
    if (stopInterview()) {
      context.setInterviewState('ENDED')
      stopHrRecording()
      stopCandidateRecording()
      stopMeetingRoom()
    }
  }

  const handleLogout = () => {
    stopHrRecording()
    stopCandidateRecording()
    stopMeetingRoom()
    disconnect()
    localStorage.removeItem('token')
    localStorage.removeItem('candidate_name')
    localStorage.removeItem('interview_mode')
    localStorage.removeItem('candidate_id')
    localStorage.removeItem('login_timestamp')
    navigate('/login')
  }

  // Setup Phase
  if (!setupComplete) {
    return (
      <div style={{ padding: '40px', maxWidth: '500px', margin: '0 auto', marginTop: '100px' }}>
        <h1>Interview Setup</h1>
        
        {error && (
          <div style={{ color: '#dc2626', marginBottom: '16px', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Candidate Name
          </label>
          <input
            type="text"
            value={setup.candidateName}
            onChange={(e) => setSetup({ ...setup, candidateName: e.target.value })}
            placeholder="Enter candidate name"
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Position
          </label>
          <input
            type="text"
            value={setup.position}
            onChange={(e) => setSetup({ ...setup, position: e.target.value })}
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
            Duration (minutes)
          </label>
          <input
            type="number"
            value={setup.duration}
            onChange={(e) => setSetup({ ...setup, duration: parseInt(e.target.value) })}
            min="15"
            max="120"
            style={{
              width: '100%',
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <button
          onClick={handleStartSetup}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          Continue to Interview
        </button>

        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#e5e7eb',
            color: '#374151',
            border: 'none',
            borderRadius: '4px',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </div>
    )
  }

  // Interview Phase
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f3f4f6' }}>
      {/* Header */}
      <div style={{ padding: '16px', backgroundColor: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0' }}>Interview: {setup.candidateName}</h2>
            <p style={{ margin: '0', fontSize: '14px', color: '#6b7280', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span>Position: {setup.position}</span>
              <span style={{ color: '#0f172a', fontWeight: '600' }}>• Mode: {modeLabel}</span>
              <span style={{ color: isConnected ? '#10b981' : '#ef4444' }}>
                {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
              </span>
            </p>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              backgroundColor: '#e5e7eb',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '0' }}>
        {/* Left Panel - Meeting Room & Transcript */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', backgroundColor: 'white' }}>
          
          {/* Top: Meeting Room */}
          <div id="meetingRoomContainer" style={{ flex: 0.5, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600' }}>Meeting Room</h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={hrMicOn ? handleStopHrMic : handleStartHrMic}
                  style={{ padding: '6px 10px', fontSize: '12px', backgroundColor: hrMicOn ? '#ef4444' : '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  {hrMicOn ? 'Stop HR Mic' : 'Start HR Mic'}
                </button>
                <button
                  onClick={candidateMicOn ? handleStopCandidateMic : handleStartCandidateMic}
                  disabled={!isSharing && !screenStream}
                  style={{ padding: '6px 10px', fontSize: '12px', backgroundColor: candidateMicOn ? '#ef4444' : '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: candidateMicOn ? 'pointer' : 'pointer', opacity: (!isSharing && !screenStream) ? 0.6 : 1 }}
                >
                  {candidateMicOn ? 'Stop Candidate Mic' : 'Start Candidate Mic'}
                </button>
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', position: 'relative', overflow: 'hidden' }}>
              {isSharing && screenStream ? (
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <video
                    className="meeting-room-video"
                    ref={(el) => {
                      if (el && el.srcObject !== screenStream) {
                        el.srcObject = screenStream
                      }
                    }}
                    autoPlay
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />

                  <div className="meeting-room-status connected" style={{ position: 'absolute', top: '12px', left: '12px', fontSize: '12px', fontWeight: 600, padding: '6px 8px' }}>
                    SHARING
                  </div>

                  <div className="meeting-room-controls" style={{ position: 'absolute', bottom: '12px', right: '12px', display: 'flex', gap: '8px' }}>
                    <button
                      className="room-control-btn"
                      onClick={stopMeetingRoom}
                      style={{ padding: '8px 12px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Stop
                    </button>
                    <button
                      className="room-control-btn"
                      onClick={handleReselectMeetingRoom}
                      style={{ padding: '8px 12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      Reselect
                    </button>
                  </div>
                </div>
              ) : (
                <div className="meeting-room-setup" id="meetingRoomSetup" style={{ textAlign: 'center', color: '#fff' }}>
                  <div className="meeting-room-title" style={{ marginBottom: '12px' }}>
                    Select Your Meeting Room
                  </div>
                  <button
                    className="select-room-btn"
                    id="selectRoomBtn"
                    onClick={handleSelectMeetingRoom}
                    disabled={isSelecting}
                    style={{
                      padding: '12px 18px',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: isSelecting ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isSelecting ? 'Selecting...' : 'Select'}
                  </button>
                </div>
              )}

              {meetingRoomError && (
                <div style={{ position: 'absolute', top: '20px', left: '20px', backgroundColor: '#fee2e2', color: '#dc2626', padding: '8px 12px', borderRadius: '4px', fontSize: '12px' }}>
                  {meetingRoomError}
                </div>
              )}
            </div>
          </div>

          {/* Bottom: Transcript */}
          <div style={{ flex: 0.5, display: 'flex', flexDirection: 'column', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
              <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600' }}>Transcript</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              {context.transcripts.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '13px', margin: '0' }}>Waiting for transcripts...</p>
              ) : (
                context.transcripts.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      marginBottom: '8px',
                      padding: '8px',
                      backgroundColor: t.speaker === 'HR' ? '#eff6ff' : '#f0fdf4',
                      borderRadius: '4px',
                      borderLeft: `3px solid ${t.speaker === 'HR' ? '#3b82f6' : '#10b981'}`
                    }}
                  >
                    <span style={{ fontWeight: '600', fontSize: '11px', color: t.speaker === 'HR' ? '#1e40af' : '#166534' }}>
                      [{t.speaker}]
                    </span>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>{t.text}</p>
                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Analysis Area (Weak Points & Questions) */}
        <div style={{ width: '350px', display: 'flex', flexDirection: 'column', backgroundColor: 'white' }}>
          {/* Tabs Navigation */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
            <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600' }}>AI Analysis</h3>
          </div>

          {/* Analysis Content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
            
            {/* Weak Points Section */}
            <div style={{ flex: 0.5, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#fafafa' }}>
                <h4 style={{ margin: '0', fontSize: '13px', fontWeight: '600', color: '#991b1b' }}>🚨 Weak Points</h4>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {context.weakPoints.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: '12px', margin: '0' }}>Analyzing...</p>
                ) : (
                  context.weakPoints.map((wp) => (
                    <div
                      key={wp.id}
                      style={{
                        marginBottom: '10px',
                        padding: '10px',
                        backgroundColor: '#fef2f2',
                        borderRadius: '4px',
                        borderLeft: '3px solid #ef4444'
                      }}
                    >
                      <span style={{ fontWeight: '600', fontSize: '11px', color: '#991b1b' }}>
                        {wp.category}
                      </span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>{wp.description}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Suggested Questions Section */}
            <div style={{ flex: 0.5, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#fafafa' }}>
                <h4 style={{ margin: '0', fontSize: '13px', fontWeight: '600', color: '#92400e' }}>💡 Suggested Questions</h4>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                {context.suggestedQuestions.length === 0 ? (
                  <p style={{ color: '#9ca3af', fontSize: '12px', margin: '0' }}>Generating questions...</p>
                ) : (
                  context.suggestedQuestions.map((q) => (
                    <div
                      key={q.id}
                      style={{
                        marginBottom: '10px',
                        padding: '10px',
                        backgroundColor: '#fef3c7',
                        borderRadius: '4px',
                        borderLeft: '3px solid #f59e0b'
                      }}
                    >
                      <span style={{ fontWeight: '600', fontSize: '11px', color: '#92400e' }}>
                        {q.skill}
                      </span>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>{q.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer - Controls */}
      <div style={{ padding: '16px', backgroundColor: 'white', borderTop: '1px solid #e5e7eb' }}>
        {error && (
          <div style={{ color: '#dc2626', marginBottom: '12px', padding: '8px', backgroundColor: '#fee2e2', borderRadius: '4px', fontSize: '13px' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          {context.interviewState === 'NOT_STARTED' && (
            <button
              onClick={handleStartInterview}
              disabled={!(isConnected && isSharing && hrMicOn && candidateMicOn)}
              style={{
                padding: '12px 24px',
                backgroundColor: (isConnected && isSharing && hrMicOn && candidateMicOn) ? '#10b981' : '#d1d5db',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: (isConnected && isSharing && hrMicOn && candidateMicOn) ? 'pointer' : 'not-allowed'
              }}
            >
              Start Interview
            </button>
          )}

          {context.interviewState === 'RUNNING' && (
            <>
              <button
                onClick={handlePauseInterview}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Pause
              </button>
              <button
                onClick={handleStopInterview}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                End Interview
              </button>
            </>
          )}

          {context.interviewState === 'PAUSED' && (
            <>
                <button
                  onClick={handleStartInterview}
                  disabled={!(isConnected && isSharing && hrMicOn && candidateMicOn)}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: (isConnected && isSharing && hrMicOn && candidateMicOn) ? '#10b981' : '#d1d5db',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: (isConnected && isSharing && hrMicOn && candidateMicOn) ? 'pointer' : 'not-allowed'
                  }}
                >
                  Resume
                </button>
              <button
                onClick={handleStopInterview}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                End Interview
              </button>
            </>
          )}

          {context.interviewState === 'ENDED' && (
            <div style={{ textAlign: 'center', color: '#6b7280' }}>
              <p style={{ margin: '0', fontSize: '16px', fontWeight: '600' }}>Interview Ended</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px' }}>Refresh page to start new interview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
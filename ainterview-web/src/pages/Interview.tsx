import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInterview } from '../contexts/InterviewContext'
import { useWebSocket } from '../hooks/useWebSocket'
import { useMeetingRoom } from '../hooks/useMeetingRoom'
import { useAudioCapture } from '../hooks/useAudioCapture'
import '../App.css'

interface InterviewSetup {
  candidateName: string
  position: string
  duration: number
}

export const Interview: React.FC = () => {
  const navigate = useNavigate()
  const context = useInterview()
  const { isConnected, startInterview, pauseInterview, stopInterview } = useWebSocket()
  const { screenStream, isSharing, selectMeetingRoom, stopMeetingRoom, error: meetingRoomError } = useMeetingRoom()
  const { startHrRecording, stopHrRecording, stopCandidateRecording } = useAudioCapture(
    (block) => {
      // Add transcript to context
      context.addTranscript({
        id: block.id,
        speaker: block.speaker,
        text: block.transcript,
        timestamp: block.timestamp,
        isFinal: true
      })
    }
  )
  
  const [setup, setSetup] = useState<InterviewSetup>({
    candidateName: '',
    position: 'Software Engineer',
    duration: 60
  })
  const [setupComplete, setSetupComplete] = useState(false)
  const [error, setError] = useState('')

  // Check authentication
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      navigate('/login')
    }
  }, [navigate])

  // Configure AssemblyAI token when setup completes
  useEffect(() => {
    if (setupComplete) {
      // TODO: Get token from backend or environment
      // For now, skip audio setup until token is available
      console.log('Setup complete. Audio will be initialized when token is available.')
    }
  }, [setupComplete])

  const handleStartSetup = () => {
    if (!setup.candidateName.trim()) {
      setError('Please enter candidate name')
      return
    }
    setError('')
    setSetupComplete(true)
  }

  const handleStartInterview = () => {
    if (!isConnected) {
      setError('WebSocket not connected. Please wait...')
      return
    }

    if (!isSharing) {
      setError('Please select meeting room first')
      return
    }

    if (startInterview()) {
      context.setInterviewState('RUNNING')
      // Start HR audio capture
      startHrRecording().catch((err) => {
        console.error('Failed to start HR audio:', err)
        setError('Audio capture failed: ' + err.message)
      })
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

  const handleStopInterview = () => {
    if (stopInterview()) {
      context.setInterviewState('ENDED')
      stopHrRecording()
      stopCandidateRecording()
      stopMeetingRoom()
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
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
            <p style={{ margin: '0', fontSize: '14px', color: '#6b7280' }}>
              Position: {setup.position}
              {' | '}
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
          <div style={{ flex: 0.5, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: '0', fontSize: '14px', fontWeight: '600' }}>Meeting Room</h3>
              <button
                onClick={isSharing ? stopMeetingRoom : selectMeetingRoom}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  backgroundColor: isSharing ? '#ef4444' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {isSharing ? '❌ Stop Share' : '📺 Select Room'}
              </button>
            </div>
            <div style={{ flex: 1, backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', position: 'relative', overflow: 'hidden' }}>
              {isSharing && screenStream ? (
                <video
                  ref={(el) => {
                    if (el && el.srcObject !== screenStream) {
                      el.srcObject = screenStream
                    }
                  }}
                  autoPlay
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '18px', marginBottom: '8px' }}>📺</p>
                  <p style={{ margin: '0', fontSize: '14px' }}>{isSharing ? 'Loading...' : 'Click "Select Room" to start screen share'}</p>
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
              disabled={!isConnected}
              style={{
                padding: '12px 24px',
                backgroundColor: isConnected ? '#10b981' : '#d1d5db',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: isConnected ? 'pointer' : 'not-allowed'
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
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
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
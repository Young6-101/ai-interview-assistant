import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInterview } from '../contexts/InterviewContext'
import { setApiToken } from '../services/api'

const modeOptions = [
  { value: 'mode1' },
  { value: 'mode2' },
  { value: 'mode3' }
] as const

type ModeOption = (typeof modeOptions)[number]['value']

const generateToken = (username: string): string => {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = `${username}:${timestamp}`
  return btoa(payload)
}

const COMMON_PASSWORD = 'nus2026' // PASSWORD

export const Login = () => {
  const navigate = useNavigate()
  const context = useInterview()
  const [candidateName, setCandidateName] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<ModeOption>('mode1')
  const [error, setError] = useState('')

  const handleStartInterview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmedName = candidateName.trim()
    if (!trimmedName) {
      setError('Please share your name to continue.')
      return
    }
    if (password !== COMMON_PASSWORD) {
      setError('Invalid password.')
      return
    }

    setError('')
    const timestamp = new Date().toISOString()
    const token = generateToken(trimmedName)

    // Save to Context (Memory Only)
    context.setCandidateName(trimmedName)
    context.setToken(token)
    context.setInterviewMode(mode)
    context.setCandidateId(`local_${timestamp}`)

    // Save to API (Memory Only)
    setApiToken(token)

    // Clear any residual localStorage
    localStorage.clear()

    navigate('/interview')
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,                     // ✅ 覆盖整个视窗
        left: 0,                    // ✅ 覆盖整个视窗  
        width: '100vw',             // ✅ 填充整个宽度
        height: '100vh',            // ✅ 填充整个高度
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0f172a',  // ✅ 背景色填充满
        overflow: 'hidden'          // ✅ 禁止滚动
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          padding: '40px',
          borderRadius: '16px',
          boxShadow: '0 25px 50px rgba(15,23,42,0.25)',
          width: '420px'
        }}
      >
        <h1
          style={{
            fontSize: '26px',
            fontWeight: '600',
            color: '#0f172a',
            marginBottom: '8px',
            textAlign: 'center'
          }}
        >
          AI Interview
        </h1>
        <p style={{ color: '#475569', fontSize: '14px', textAlign: 'center', marginBottom: '24px' }}>
          Simple testing flow: enter your name, pick a mode, and start the interview (no recording is stored).
        </p>

        {error && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              padding: '14px',
              borderRadius: '6px',
              marginBottom: '18px',
              fontSize: '14px'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleStartInterview} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label style={{ display: 'block', fontWeight: '600', color: '#0f172a', marginBottom: '6px' }}>
              Your name
            </label>
            <input
              type='text'
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder='Jane Doe'
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #cbd5f5',
                fontSize: '15px',
                backgroundColor: '#f8fafc'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '600', color: '#0f172a', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Enter password'
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #cbd5f5',
                fontSize: '15px',
                backgroundColor: '#f8fafc'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '600', color: '#0f172a', marginBottom: '10px' }}>
              Choose a mode
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {modeOptions.map((option) => {
                const isSelected = option.value === mode
                return (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => setMode(option.value)}
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#1d4ed8' : '#f8fafc',
                      color: isSelected ? '#ffffff' : '#0f172a',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '15px'
                    }}
                  >
                    {option.value}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type='submit'
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontWeight: '600',
              border: 'none',
              fontSize: '17px',
              cursor: 'pointer'
            }}
          >
            Start Interview
          </button>
        </form>
      </div>
    </div>
  )
}
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

const modeOptions = [
  { value: 'mode1', label: 'Mode 1 · Standard', description: 'Normal interview mode without AI notifications.' },
  { value: 'mode2', label: 'Mode 2 · Transparent', description: 'Shows AI warning for 10 seconds when generating questions.' },
  { value: 'mode3', label: 'Mode 3 · Full Disclosure', description: 'Continuously displays AI usage warning to candidate.' }
] as const

type ModeOption = (typeof modeOptions)[number]['value']

const generateToken = (username: string): string => {
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = `${username}:${timestamp}`
  return btoa(payload)
}

export const Login = () => {
  const navigate = useNavigate()
  const [candidateName, setCandidateName] = useState('')
  const [mode, setMode] = useState<ModeOption>('mode1')
  const [error, setError] = useState('')

  const handleStartInterview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmedName = candidateName.trim()
    if (!trimmedName) {
      setError('Please share your name to continue.')
      return
    }

    setError('')
    const timestamp = new Date().toISOString()
    const token = generateToken(trimmedName)
    localStorage.setItem('token', token)
    localStorage.setItem('candidate_name', trimmedName)
    localStorage.setItem('interview_mode', mode)
    localStorage.setItem('candidate_id', `local_${timestamp}`)
    localStorage.setItem('login_timestamp', timestamp)
    navigate('/interview')
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0f172a'
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
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '14px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#1d4ed8' : '#f8fafc',
                      color: isSelected ? '#ffffff' : '#0f172a',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ fontWeight: '600', fontSize: '15px' }}>{option.label}</span>
                    <span style={{ fontSize: '13px', color: isSelected ? '#bfdbfe' : '#475569', marginTop: '4px' }}>
                      {option.description}
                    </span>
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
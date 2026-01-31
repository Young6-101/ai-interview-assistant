import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../services/api'

const modeOptions = [
  { value: 'mode1', label: 'Mode 1 · Guided', description: 'Structured script with coaching hints.' },
  { value: 'mode2', label: 'Mode 2 · Open Q&A', description: 'Free-form chat for relaxed practice.' },
  { value: 'mode3', label: 'Mode 3 · Expert', description: 'Detailed critique + edge-case follow-ups.' }
] as const

type ModeOption = (typeof modeOptions)[number]['value']

export const Login: React.FC = () => {
  const navigate = useNavigate()
  const [candidateName, setCandidateName] = useState('')
  const [mode, setMode] = useState<ModeOption>('mode1')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = candidateName.trim()
    if (!trimmedName) {
      setError('Please share your name to continue.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const response = await authAPI.login(trimmedName, mode)
      localStorage.setItem('token', response.access_token)
      localStorage.setItem('candidate_name', response.candidate_name)
      localStorage.setItem('interview_mode', response.mode)
      localStorage.setItem('candidate_id', response.candidate_id)
      localStorage.setItem('login_timestamp', response.recorded_at)
      navigate('/interview')
    } catch (err: any) {
      const message = err?.response?.data?.detail || err?.message || 'Unable to record your name right now.'
      setError(message)
    } finally {
      setLoading(false)
    }
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
          AI Interview Lab
        </h1>
        <p style={{ color: '#475569', fontSize: '14px', textAlign: 'center', marginBottom: '24px' }}>
          Testing mode only—just tell us your name and pick a mode to start recording.
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

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
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
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '10px',
              backgroundColor: loading ? '#94a3b8' : '#2563eb',
              color: '#ffffff',
              fontWeight: '600',
              border: 'none',
              fontSize: '16px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Recording...' : 'Record name & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
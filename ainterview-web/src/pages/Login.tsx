import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../services/api'

export const Login: React.FC = () => {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await authAPI.login(username, password)
      localStorage.setItem('token', response.access_token)
      navigate('/interview')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#3b82f6' }}>
      <div style={{ backgroundColor: 'white', padding: '32px', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', width: '384px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937', marginBottom: '24px', textAlign: 'center' }}>
          AI Interview Assistant
        </h1>

        {error && (
          <div style={{ backgroundColor: '#fee2e2', border: '1px solid #fecaca', color: '#dc2626', padding: '12px', borderRadius: '4px', marginBottom: '16px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', color: '#374151', fontWeight: '600', marginBottom: '8px' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g., hr1"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', color: '#374151', fontWeight: '600', marginBottom: '8px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="e.g., 123"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              backgroundColor: loading ? '#d1d5db' : '#3b82f6',
              color: 'white',
              fontWeight: '600',
              padding: '10px',
              borderRadius: '4px',
              border: 'none',
              fontSize: '16px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p style={{ color: '#6b7280', fontSize: '14px', textAlign: 'center', marginTop: '16px' }}>
          Demo credentials: hr1/123, hr2/456, admin/000
        </p>
      </div>
    </div>
  )
}
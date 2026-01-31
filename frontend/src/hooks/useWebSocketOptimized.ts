import { useEffect, useRef, useCallback } from 'react'
import { useInterview } from '../contexts/InterviewContext'

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const WS_URL = (() => {
  if (API_BASE_URL.startsWith('https://')) return API_BASE_URL.replace('https://', 'wss://') + '/ws'
  if (API_BASE_URL.startsWith('http://')) return API_BASE_URL.replace('http://', 'ws://') + '/ws'
  return `ws://${API_BASE_URL}/ws`
})()

interface WebSocketMessage {
  type: string
  payload?: any
  [key: string]: any
}

interface TranscriptDOM {
  id: string
  speaker: 'HR' | 'CANDIDATE'
  text: string
  timestamp: number
  isFinal: boolean
}

/**
 * OPTIMIZED WebSocket Hook
 * Key improvements:
 * 1. Direct DOM manipulation for transcript updates (no React re-renders)
 * 2. Handles partial_transcript_update for real-time typing effect
 * 3. Only updates Context for global state (weak_points, suggestions)
 * 4. Implements upsertTranscriptElement pattern from reference
 */
export const useWebSocketOptimized = () => {
  const context = useInterview()
  const wsRef = useRef<WebSocket | null>(null)

  // DOM References for direct manipulation
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)
  const transcriptsMapRef = useRef<Map<string, TranscriptDOM>>(new Map())

  // Reconnection management
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttemptsRef = useRef(5)
  const reconnectDelayRef = useRef(3000)

  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])

  const handleCloseRef = useRef<(event: CloseEvent) => void>(() => {})

  /**
   * Set the container reference for transcript DOM operations
   */
  const setTranscriptContainer = useCallback((container: HTMLDivElement | null) => {
    transcriptContainerRef.current = container
  }, [])

  /**
   * ✅ OPTIMIZATION: Direct DOM manipulation instead of React state
   * Pattern from reference: upsertTranscriptElement
   */
  const upsertTranscriptDOM = useCallback(
    (payload: {
      id: string
      speaker: 'HR' | 'CANDIDATE'
      text: string
      timestamp: number
      isFinal: boolean
    }) => {
      const container = transcriptContainerRef.current
      if (!container) return

      const existingElement = document.getElementById(`transcript-${payload.id}`)

      if (existingElement) {
        // ✅ Element exists: only update text content
        const textNode = existingElement.querySelector('.transcript-text')
        if (textNode) {
          textNode.textContent = payload.text
        }

        if (payload.isFinal) {
          // Mark as final
          existingElement.classList.remove('speaking')
          existingElement.classList.add('final')
        }
      } else {
        // ✅ New element: create DOM node
        const div = document.createElement('div')
        div.id = `transcript-${payload.id}`
        div.className = `transcript-item ${payload.speaker === 'HR' ? 'hr' : 'candidate'}`
        div.style.cssText = `
          padding: 12px;
          border-radius: 12px;
          background-color: ${payload.speaker === 'HR' ? '#eff6ff' : '#f0fdf4'};
          border-left: 3px solid ${payload.speaker === 'HR' ? '#3b82f6' : '#10b981'};
          margin-bottom: 10px;
        `

        const speakerSpan = document.createElement('span')
        speakerSpan.style.cssText = `
          font-size: 12px;
          font-weight: 600;
          color: ${payload.speaker === 'HR' ? '#1d4ed8' : '#047857'};
        `
        speakerSpan.textContent = `[${payload.speaker}]`

        const textDiv = document.createElement('p')
        textDiv.className = 'transcript-text'
        textDiv.style.cssText = 'margin: 6px 0 4px; font-size: 13px; color: #0f172a;'
        textDiv.textContent = payload.text

        const timeSpan = document.createElement('span')
        timeSpan.style.cssText = 'font-size: 11px; color: #94a3b8;'
        timeSpan.textContent = new Date(payload.timestamp).toLocaleTimeString()

        div.appendChild(speakerSpan)
        div.appendChild(textDiv)
        div.appendChild(document.createElement('br'))
        div.appendChild(timeSpan)

        container.appendChild(div)

        // Auto-scroll to bottom
        setTimeout(() => {
          container.scrollTop = container.scrollHeight
        }, 0)
      }

      // Store in local map (for debugging/reference)
      transcriptsMapRef.current.set(payload.id, payload)
    },
    []
  )

  /**
   * Message sender
   */
  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    console.warn('WebSocket not ready, message dropped:', message.type)
    return false
  }, [])

  /**
   * Send transcript
   */
  const sendTranscript = useCallback(
    (speaker: string, text: string, timestamp?: number) => {
      if (!text?.trim()) return false
      return send({
        type: 'transcript',
        payload: {
          speaker: speaker.toLowerCase(),
          text,
          timestamp: timestamp ?? Date.now()
        }
      })
    },
    [send]
  )

  /**
   * ✅ MAIN OPTIMIZATION: Message handler with partial update support
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as WebSocketMessage

      // 1. SILENT HEARTBEAT
      if (data.type === 'pong') return

      // 2. LOGGING
      const importantTypes = ['session_started', 'session_ended', 'new_transcript', 'weak_points_updated']
      if (importantTypes.includes(data.type)) {
        console.log(`[WS Event] ${data.type}`, data.payload || '')
      }

      // 3. STATE UPDATES
      switch (data.type) {
        case 'session_started':
          contextRef.current.setInterviewState('RUNNING')
          break

        case 'session_ended':
          contextRef.current.setInterviewState('ENDED')
          break

        /**
         * ✅ OPTIMIZATION: Handle partial transcript updates
         * These come in frequently (every 100ms) and should NOT trigger React re-renders
         * Instead, we directly modify the DOM
         */
        case 'partial_transcript_update': {
          const payload = data.payload || data
          upsertTranscriptDOM({
            id: payload.id || `${Date.now()}`,
            speaker: (payload.speaker || 'UNKNOWN').toUpperCase() as 'HR' | 'CANDIDATE',
            text: payload.text || '',
            timestamp: payload.timestamp || Date.now(),
            isFinal: false
          })
          // ❌ NO Context update here! DOM is already updated
          break
        }

        /**
         * ✅ Final transcript - update DOM and Context
         */
        case 'new_transcript':
        case 'transcript_update': {
          const payload = data.payload || data
          upsertTranscriptDOM({
            id: payload.id || `${Date.now()}`,
            speaker: (payload.speaker || 'UNKNOWN').toUpperCase() as 'HR' | 'CANDIDATE',
            text: payload.text || payload.transcript || '',
            timestamp: payload.timestamp || Date.now(),
            isFinal: true
          })
          // Also sync to Context for any components that might need it
          contextRef.current.addTranscript({
            id: payload.id || `${Date.now()}`,
            speaker: (payload.speaker || 'UNKNOWN').toUpperCase() as 'HR' | 'CANDIDATE',
            text: payload.text || payload.transcript || '',
            timestamp: payload.timestamp || Date.now(),
            isFinal: true
          })
          break
        }

        /**
         * ✅ Weak points - keep in Context
         */
        case 'weak_points_updated': {
          const payload = data.payload || data
          const points = Array.isArray(payload) ? payload : [payload]
          points.forEach((point: any) => {
            contextRef.current.addWeakPoint({
              id: point.id || `${Date.now()}`,
              category: point.category || 'General',
              description: point.description || '',
              details: point.details,
              timestamp: Date.now()
            })
          })
          break
        }

        /**
         * ✅ Suggested questions - keep in Context
         */
        case 'suggested_questions': {
          const payload = data.payload || data
          const questions = Array.isArray(payload) ? payload : [payload]
          questions.forEach((q: any) => {
            contextRef.current.addSuggestedQuestion({
              id: q.id || `${Date.now()}`,
              text: q.text || q.question || '',
              skill: q.skill || q.category || 'General',
              timestamp: Date.now()
            })
          })
          break
        }

        default:
          console.log('Unhandled message:', data.type)
      }
    } catch (e) {
      console.error('WS Parse Error:', e)
    }
  }, [upsertTranscriptDOM])

  /**
   * Core connection
   */
  const connect = useCallback((url: string = WS_URL) => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    try {
      console.log('--- Connecting to Backend WebSocket ---')
      const socket = new WebSocket(url)

      wsRef.current = socket

      socket.onopen = () => {
        console.log('✅ Local Backend WS: Connected')
        contextRef.current.setWebSocketConnected(true)
        reconnectAttemptsRef.current = 0

        socket.send(JSON.stringify({ type: 'ping' }))
      }

      socket.onmessage = handleMessage

      socket.onclose = (e) => {
        handleCloseRef.current(e)
      }

      socket.onerror = (err) => {
        console.error('❌ WebSocket physical error:', err)
        contextRef.current.setWebSocketConnected(false)
      }
    } catch (err) {
      console.error('WebSocket creation failed:', err)
    }
  }, [handleMessage])

  /**
   * Disconnection & reconnection
   */
  const handleClose = useCallback((event?: CloseEvent) => {
    console.log(`WebSocket Disconnected (Code: ${event?.code})`)
    contextRef.current.setWebSocketConnected(false)

    if (event?.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttemptsRef.current) {
      reconnectAttemptsRef.current += 1
      const delay = reconnectDelayRef.current
      console.log(`Reconnecting ${reconnectAttemptsRef.current}/${maxReconnectAttemptsRef.current} in ${delay}ms...`)
      setTimeout(() => connect(), delay)
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
    }
  }, [connect])

  useEffect(() => {
    handleCloseRef.current = handleClose
  }, [handleClose])

  /**
   * Cleanup
   */
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        console.log('Cleaning up WebSocket on unmount')
        wsRef.current.close(1000)
        wsRef.current = null
      }
    }
  }, [])

  return {
    isConnected: context.isWebSocketConnected,
    connect,
    send,
    sendTranscript,
    startInterview: useCallback(() => {
      const token = localStorage.getItem('token') || localStorage.getItem('access_token')
      const mode = localStorage.getItem('interview_mode') || 'mode1'
      return send({ type: 'start', token, mode })
    }, [send]),
    stopInterview: useCallback(() => send({ type: 'end' }), [send]),
    disconnect: useCallback(() => wsRef.current?.close(1000), []),
    setTranscriptContainer
  }
}

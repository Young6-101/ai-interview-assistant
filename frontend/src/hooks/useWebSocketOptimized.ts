import { useEffect, useRef, useCallback } from 'react'
import { useInterview } from '../contexts/InterviewContext'

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const WS_URL = (() => {
  if (API_BASE_URL.startsWith('http')) {
    return API_BASE_URL.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
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

  const handleCloseRef = useRef<(event: CloseEvent) => void>(() => { })

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
        // ✅ Element exists: only update text content (no speaker prefix - already shown separately)
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
        // ✅ New element: create DOM node - speaker and content in one line
        const div = document.createElement('div')
        div.id = `transcript-${payload.id}`
        div.className = `transcript-item ${payload.speaker === 'HR' ? 'recruiter' : 'candidate'}`
        div.style.cssText = `
          padding: 8px 12px;
          margin-bottom: 4px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.4;
          text-align: left;
`

        const speakerSpan = document.createElement('span')
        speakerSpan.style.cssText = `
          font-weight: 600;
          color: ${payload.speaker === 'HR' ? '#3b82f6' : '#10b981'};
        `
        speakerSpan.textContent = payload.speaker === 'HR' ? 'RECRUITER' : payload.speaker

        const colonSpan = document.createElement('span')
        colonSpan.style.cssText = 'color: #6b7280;'
        colonSpan.textContent = ': '

        // 对话内容（深灰）
        const textSpan = document.createElement('span')
        textSpan.className = 'transcript-text'
        textSpan.style.cssText = 'color: #374151;'
        textSpan.textContent = payload.text

        // 组装
        div.appendChild(speakerSpan)
        div.appendChild(colonSpan)
        div.appendChild(textSpan)

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
   * Send partial transcript for real-time display
   * This updates the UI immediately without storing in backend
   */
  const sendPartialTranscript = useCallback(
    (id: string, speaker: string, text: string, timestamp?: number) => {
      if (!text?.trim()) return false

      // ✅ Update DOM directly for instant feedback (no round-trip to backend)
      upsertTranscriptDOM({
        id,
        speaker: speaker.toUpperCase() as 'HR' | 'CANDIDATE',
        text,
        timestamp: timestamp ?? Date.now(),
        isFinal: false
      })

      return true
    },
    [upsertTranscriptDOM]
  )

  /**
   * Message handler with partial update support
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
         * Skip if we already have this transcript (to avoid duplicates from broadcast)
         */
        case 'new_transcript':
        case 'transcript_update': {
          const payload = data.payload || data
          const speaker = (payload.speaker || 'UNKNOWN').toUpperCase() as 'HR' | 'CANDIDATE'
          const text = payload.text || payload.transcript || ''
          const timestamp = payload.timestamp || Date.now()

          // Check if we already displayed this transcript via partial updates
          // by looking for existing elements with same speaker that have similar text
          const container = transcriptContainerRef.current
          if (container) {
            const existingItems = container.querySelectorAll(`.transcript-item.${speaker === 'HR' ? 'recruiter' : 'candidate'}`)
            const lastItem = existingItems[existingItems.length - 1]
            if (lastItem) {
              const existingText = lastItem.querySelector('.transcript-text')?.textContent || ''
              // If existing text matches or is substring of new text, just mark as final
              if (existingText === text || text.includes(existingText)) {
                console.log('📝 Skipping duplicate transcript, marking existing as final')
                lastItem.classList.remove('speaking')
                lastItem.classList.add('final')
                // Update text if needed (in case partial was incomplete)
                const textNode = lastItem.querySelector('.transcript-text')
                if (textNode) textNode.textContent = text
                break
              }
            }
          }

          console.log('📝 Received new transcript:', payload)
          upsertTranscriptDOM({
            id: payload.id || `backend_${Date.now()}`,
            speaker,
            text,
            timestamp,
            isFinal: true
          })
          // Also sync to Context for any components that might need it
          contextRef.current.addTranscript({
            id: payload.id || `backend_${Date.now()}`,
            speaker,
            text,
            timestamp,
            isFinal: true
          })
          break
        }

        /**
         * ✅ Weak points - keep in Context
         */
        case 'weak_points_updated': {
          const weakPoints = data.weak_points || data.payload || []
          const points = Array.isArray(weakPoints) ? weakPoints : [weakPoints]
          points.forEach((point: any, index: number) => {
            contextRef.current.addWeakPoint({
              id: point.id || `wp_${Date.now()}_${index}`,
              category: point.component || point.category || 'General',
              description: point.question || point.description || '',
              details: point.severity || point.details,
              timestamp: Date.now()
            })
          })
          break
        }

        /**
         * ✅ Suggested questions - keep in Context
         */
        case 'suggested_questions': {
          const questions = data.questions || data.payload || []
          const questionList = Array.isArray(questions) ? questions : [questions]
          questionList.forEach((q: any, index: number) => {
            // Handle both string and object formats
            const questionText = typeof q === 'string' ? q : (q.text || q.question || '')
            if (questionText) {
              contextRef.current.addSuggestedQuestion({
                id: `q_${Date.now()}_${index}`,
                text: questionText,
                skill: typeof q === 'object' ? (q.skill || q.category || 'Follow-up') : 'Follow-up',
                timestamp: Date.now()
              })
            }
          })
          break
        }

        default:
          if (data.type === 'error') {
            console.warn('⚠️ Backend error:', data.payload || data)
          } else {
            console.log('Unhandled message:', data.type)
          }
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

  /**
   * Request AI analysis manually
   */
  const requestAnalysis = useCallback(() => {
    console.log('🤖 Requesting AI analysis...')
    return send({ type: 'request_analysis' })
  }, [send])

  return {
    isConnected: context.isWebSocketConnected,
    connect,
    send,
    sendTranscript,
    sendPartialTranscript,
    requestAnalysis,
    startInterview: useCallback(() => {
      // Use Context instead of localStorage
      const token = contextRef.current.token
      const mode = contextRef.current.interviewMode
      return send({ type: 'start', token, mode })
    }, [send]),
    stopInterview: useCallback(() => send({ type: 'end' }), [send]),
    disconnect: useCallback(() => wsRef.current?.close(1000), []),
    setTranscriptContainer
  }
}

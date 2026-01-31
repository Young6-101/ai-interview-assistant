import { useEffect, useRef, useCallback } from 'react'
import { useInterview } from '../contexts/InterviewContext'

/**
 * WebSocket URL Derivation
 */
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

export const useWebSocket = () => {
  const context = useInterview()
  const wsRef = useRef<WebSocket | null>(null)
  
  // Reconnection management
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttemptsRef = useRef(5)
  const reconnectDelayRef = useRef(3000)

  // Stable reference for Context to avoid infinite re-renders
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])

  // Ref for the close handler to ensure the latest logic is used in events
  const handleCloseRef = useRef<(event: CloseEvent) => void>(() => {})

  /**
   * General Message Sender
   */
  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    // This warning might still trigger if called before OPEN state
    console.warn('WebSocket not ready, message dropped:', message.type)
    return false
  }, [])

  /**
   * Business Logic: Send transcripts
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
   * Message Handler: Processes incoming JSON
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as WebSocketMessage
      
      // 1. SILENT HEARTBEAT: Ignore pong messages immediately
      if (data.type === 'pong') return

      // 2. LOGGING: Log only business-relevant messages
      const importantTypes = ['session_started', 'session_ended', 'new_transcript', 'weak_points_updated']
      if (importantTypes.includes(data.type)) {
        console.log(`[WS Event] ${data.type}`, data.payload || '')
      }

      // 3. STATE UPDATES: Using contextRef to avoid triggering re-renders of the hook
      switch (data.type) {
        case 'session_started':
          contextRef.current.setInterviewState('RUNNING')
          break
        case 'session_ended':
          contextRef.current.setInterviewState('ENDED')
          break
        case 'new_transcript':
        case 'transcript_update': {
          const payload = data.payload || data
          contextRef.current.addTranscript({
            id: payload.id || `${Date.now()}`,
            speaker: (payload.speaker || 'UNKNOWN').toUpperCase() as 'HR' | 'CANDIDATE',
            text: payload.text || payload.transcript || '',
            timestamp: payload.timestamp || Date.now(),
            isFinal: true
          })
          break
        }
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
        default:
          console.log('Unhandled message:', data.type)
      }
    } catch (e) {
      console.error('WS Parse Error:', e)
    }
  }, [])

  /**
   * Core Connection Function
   * FIXED: Ensures initialization order to prevent "dropped: ping"
   */
  const connect = useCallback((url: string = WS_URL) => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    try {
      console.log('--- Connecting to Backend WebSocket ---')
      const socket = new WebSocket(url)

      // CRITICAL FIX: Assign to Ref immediately before event binding
      wsRef.current = socket

      socket.onopen = () => {
        console.log('✅ Local Backend WS: Connected')
        contextRef.current.setWebSocketConnected(true)
        reconnectAttemptsRef.current = 0
        
        // CRITICAL FIX: Use raw socket to send initial ping to bypass wrapper checks
        socket.send(JSON.stringify({ type: 'ping' }))
      }

      socket.onmessage = handleMessage
      
      socket.onclose = (e) => {
        // Trigger handleCloseRef which points to our latest handleClose logic
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
   * Disconnection & Reconnection logic
   */
  const handleClose = useCallback((event?: CloseEvent) => {
    console.log(`WebSocket Disconnected (Code: ${event?.code})`)
    contextRef.current.setWebSocketConnected(false)
    
    // Abnormal closure: attempt reconnect (unless it's code 1000 - manual close)
    if (event?.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttemptsRef.current) {
      reconnectAttemptsRef.current += 1
      const delay = reconnectDelayRef.current
      console.log(`Reconnecting ${reconnectAttemptsRef.current}/${maxReconnectAttemptsRef.current} in ${delay}ms...`)
      setTimeout(() => connect(), delay)
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
    }
  }, [connect])

  // Keep handleCloseRef updated
  useEffect(() => {
    handleCloseRef.current = handleClose
  }, [handleClose])

  /**
   * Component Cleanup
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
    disconnect: useCallback(() => wsRef.current?.close(1000), [])
  }
}
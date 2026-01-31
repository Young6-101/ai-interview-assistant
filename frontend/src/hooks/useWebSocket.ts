import { useEffect, useRef, useCallback } from 'react'
import { useInterview } from '../contexts/InterviewContext'

/**
 * WebSocket configuration and URL derivation
 */
const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const WS_URL = (() => {
  if (API_BASE_URL.startsWith('https://')) {
    return API_BASE_URL.replace('https://', 'wss://') + '/ws'
  }
  if (API_BASE_URL.startsWith('http://')) {
    return API_BASE_URL.replace('http://', 'ws://') + '/ws'
  }
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
  
  // Ref pattern to handle the latest context without triggering re-renders
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])

  // Ref for the close handler to prevent stale closures in event listeners
  const handleCloseRef = useRef<(event: CloseEvent) => void>(() => {})

  /**
   * Generic message sender
   */
  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    console.warn('WebSocket unavailable, message dropped:', message.type)
    return false
  }, [])

  /**
   * Sends transcript data to the backend
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
   * Message Router: Processes incoming data from backend
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage
        
        // 1. SILENT HEARTBEAT: Exit immediately if it's a pong/ping
        if (data.type === 'pong' || data.type === 'ping') {
          return
        }

        // 2. LOGGING: Only log meaningful business messages
        const businessTypes = ['session_started', 'session_ended', 'new_transcript', 'weak_points_updated']
        if (businessTypes.includes(data.type)) {
          console.log('WebSocket Event:', data.type, data.payload || '')
        }

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
              id: payload.id || `${Date.now()}_${Math.random()}`,
              speaker: ((payload.speaker || 'UNKNOWN') as string).toUpperCase() as 'HR' | 'CANDIDATE',
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
                id: point.id || `${Date.now()}_${Math.random()}`,
                category: point.category || 'General',
                description: point.description || point.text || '',
                details: point.details || point.explanation,
                timestamp: point.timestamp || Date.now()
              })
            })
            break
          }
          default:
            console.log('Unhandled message type:', data.type)
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    },
    [] // Stable dependencies
  )

  const handleOpen = useCallback(() => {
    console.log('WebSocket status: Connected')
    contextRef.current.setWebSocketConnected(true)
    reconnectAttemptsRef.current = 0
    reconnectDelayRef.current = 1000
    send({ type: 'ping' })
  }, [send])

  const handleError = useCallback((error: Event) => {
    console.error('WebSocket error:', error)
    contextRef.current.setWebSocketConnected(false)
  }, [])

  /**
   * Connection logic with safety checks
   */
  const connect = useCallback(
  (url: string = "ws://127.0.0.1:8000/ws") => { // 直接写死测试地址
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        console.log('--- ATTEMPTING LOCAL WS CONNECT ---');
        const socket = new WebSocket(url);
        socket.onopen = handleOpen
      } catch (e) {
        console.error('WS Connection logic crashed:', e);
      }
    },
    [handleOpen, handleMessage, handleError]
  )

  const handleClose = useCallback(
    (event?: CloseEvent) => {
      console.log(`WebSocket closed (Code: ${event?.code})`)
      contextRef.current.setWebSocketConnected(false)
      
      // Only reconnect on abnormal closure (not Code 1000)
      if (event?.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttemptsRef.current) {
        reconnectAttemptsRef.current += 1
        console.log(`Retrying connection (${reconnectAttemptsRef.current}/${maxReconnectAttemptsRef.current})...`)
        setTimeout(() => connect(), reconnectDelayRef.current)
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
      }
    },
    [connect]
  )

  useEffect(() => {
    handleCloseRef.current = handleClose
  }, [handleClose])

  /**
   * Lifecycle Cleanup: Close socket on unmount
   */
  useEffect(() => {
    // connect() is NOT called here. Manual connection is required.
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Unmounting')
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
      const token = localStorage.getItem('token') ?? localStorage.getItem('access_token')
      const mode = localStorage.getItem('interview_mode') ?? 'mode1'
      return send({ type: 'start', token, mode })
    }, [send]),
    stopInterview: useCallback(() => send({ type: 'end' }), [send]),
    disconnect: useCallback(() => wsRef.current?.close(1000), [])
  }
}
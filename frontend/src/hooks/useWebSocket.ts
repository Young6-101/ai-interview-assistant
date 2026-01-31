import { useEffect, useRef, useCallback } from 'react'
import { useInterview } from '../contexts/InterviewContext'

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
  const reconnectAttemptsRef = useRef(0)
  const maxReconnectAttemptsRef = useRef(5)
  const reconnectDelayRef = useRef(1000)
  const handleCloseRef = useRef<(event: Event) => void>(() => {})

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    }
    console.warn('WebSocket unavailable, message dropped:', message)
    return false
  }, [])

  const sendTranscript = useCallback(
    (speaker: string, text: string, timestamp?: number) => {
      if (!text?.trim()) {
        return false
      }
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

  const startInterview = useCallback(() => {
    const token = localStorage.getItem('token') ?? localStorage.getItem('access_token')
    if (!token) {
      console.warn('Cannot start interview: missing token')
      return false
    }

    const mode = localStorage.getItem('interview_mode') ?? 'mode1'
    return send({
      type: 'start',
      token,
      mode
    })
  }, [send])

  const pauseInterview = useCallback(() => send({ type: 'pause' }), [send])
  const stopInterview = useCallback(() => send({ type: 'end' }), [send])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnecting')
      wsRef.current = null
    }
  }, [])

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage
        if (!['new_transcript', 'session_started', 'session_ended', 'transcript_update', 'weak_points_updated'].includes(data.type)) {
          console.log('WebSocket received:', data.type, data)
        }

        switch (data.type) {
          case 'session_started':
            context.setInterviewState('RUNNING')
            break
          case 'session_ended':
            context.setInterviewState('ENDED')
            break
          case 'new_transcript':
          case 'transcript_update': {
            const payload = data.payload || data
            context.addTranscript({
              id: payload.id || `${Date.now()}_${Math.random()}`,
              speaker: ((payload.speaker || 'UNKNOWN') as string).toUpperCase() as 'HR' | 'CANDIDATE',
              text: payload.text || payload.transcript || '',
              timestamp: payload.timestamp || Date.now(),
              isFinal: true
            })
            break
          }
          case 'partial_transcript_update': {
            const payload = data.payload || data
            const id = payload.id || payload.block_id
            if (id) {
              context.updateTranscript(id, {
                text: payload.text || payload.transcript || ''
              })
            }
            break
          }
          case 'weak_points':
          case 'weak_points_update':
          case 'weak_points_updated': {
            const payload = data.payload || data
            const points = Array.isArray(payload) ? payload : [payload]
            points.forEach((point: any) => {
              context.addWeakPoint({
                id: point.id || `${Date.now()}_${Math.random()}`,
                category: point.category || 'General',
                description: point.description || point.text || '',
                details: point.details || point.explanation,
                timestamp: point.timestamp || Date.now()
              })
            })
            break
          }
          case 'suggested_questions_result': {
            const payload = data.payload || data
            const questions = payload.question || payload.questions
            if (questions) {
              const text = Array.isArray(questions) ? questions.join('\n') : questions
              context.addSuggestedQuestion({
                id: `${Date.now()}_${Math.random()}`,
                text,
                skill: payload.target_skill || 'General',
                timestamp: Date.now()
              })
            }
            break
          }
          case 'new_topic': {
            const payload = data.payload || data
            context.addTopic({
              id: payload.id || `${Date.now()}_${Math.random()}`,
              name: payload.name || payload.topic || '',
              timestamp: Date.now()
            })
            break
          }
          case 'topic_updated': {
            const payload = data.payload || data
            context.updateTopic(payload.id, {
              updated: Date.now()
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
    [context]
  )

  const handleOpen = useCallback(() => {
    console.log('WebSocket connected')
    context.setWebSocketConnected(true)
    reconnectAttemptsRef.current = 0
    reconnectDelayRef.current = 1000
  }, [context])

  const handleError = useCallback(
    (error: Event) => {
      console.error('WebSocket error:', error)
      context.setWebSocketConnected(false)
    },
    [context]
  )

  const connect = useCallback(
    (url: string = WS_URL) => {
      try {
        console.log('Connecting to WebSocket:', url)
        const socket = new WebSocket(url)
        wsRef.current = socket
        socket.onopen = handleOpen
        socket.onmessage = handleMessage
        socket.onclose = handleCloseRef.current
        socket.onerror = handleError
      } catch (error) {
        console.error('WebSocket connection failed:', error)
        context.setWebSocketConnected(false)
      }
    },
    [handleOpen, handleMessage, handleError, context]
  )

  const handleClose = useCallback(
    () => {
      console.log('WebSocket disconnected')
      context.setWebSocketConnected(false)
      if (reconnectAttemptsRef.current < maxReconnectAttemptsRef.current) {
        reconnectAttemptsRef.current += 1
        const delay = reconnectDelayRef.current
        console.log(`Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`)
        setTimeout(() => {
          connect()
        }, delay)
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
      }
    },
    [context, connect]
  )

  useEffect(() => {
    handleCloseRef.current = handleClose
  }, [handleClose])

  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected: context.isWebSocketConnected,
    send,
    sendTranscript,
    startInterview,
    pauseInterview,
    stopInterview,
    disconnect
  }
}

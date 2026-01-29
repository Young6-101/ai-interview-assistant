import { useEffect, useRef, useCallback } from 'react'
import { useInterview } from '../contexts/InterviewContext'

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

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    } else {
      console.warn('WebSocket not connected, message not sent:', message)
      return false
    }
  }, [])

  const startInterview = useCallback(() => {
    return send({
      type: 'action',
      action: 'start_interview',
      timestamp: Date.now()
    })
  }, [send])

  const pauseInterview = useCallback(() => {
    return send({
      type: 'action',
      action: 'pause_interview',
      timestamp: Date.now()
    })
  }, [send])

  const stopInterview = useCallback(() => {
    return send({
      type: 'action',
      action: 'end_interview',
      notes: '',
      timestamp: Date.now(),
      templateType: 'default',
      templateFile: null
    })
  }, [send])

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnecting')
      wsRef.current = null
    }
  }, [])

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as WebSocketMessage

      // Only log important non-transcript messages
      if (!['partial_transcript_update', 'new_transcript', 'transcript_update'].includes(data.type)) {
        console.log('WebSocket received:', data.type, data)
      }

      // Route to appropriate handler
      switch (data.type) {
        case 'new_transcript':
        case 'transcript_update': {
          const payload = data.payload || data
          context.addTranscript({
            id: payload.id || `${Date.now()}_${Math.random()}`,
            speaker: (payload.speaker || 'UNKNOWN').toUpperCase() as 'HR' | 'CANDIDATE',
            text: payload.transcript || payload.text || '',
            timestamp: payload.timestamp || Date.now(),
            isFinal: true
          })
          break
        }

        case 'partial_transcript_update': {
          const payload = data.payload || data
          // Update existing transcript with partial text
          const id = payload.id || payload.block_id
          if (id) {
            context.updateTranscript(id, {
              text: payload.transcript || payload.text || ''
            })
          }
          break
        }

        case 'weak_points':
        case 'weak_points_update': {
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
            const text = Array.isArray(questions)
              ? questions.join('\n')
              : questions
            context.addSuggestedQuestion({
              id: `${Date.now()}_${Math.random()}`,
              text: text,
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
  }, [context])

  const handleOpen = useCallback(() => {
    console.log('WebSocket connected')
    context.setWebSocketConnected(true)
    reconnectAttemptsRef.current = 0
    reconnectDelayRef.current = 1000
  }, [context])

  const handleClose = useCallback(() => {
    console.log('WebSocket disconnected')
    context.setWebSocketConnected(false)

    // Attempt to reconnect if not intentionally closed
    if (reconnectAttemptsRef.current < maxReconnectAttemptsRef.current) {
      reconnectAttemptsRef.current++
      console.log(`Scheduling reconnect attempt ${reconnectAttemptsRef.current} in ${reconnectDelayRef.current}ms`)
      setTimeout(() => {
        connect()
      }, reconnectDelayRef.current)

      // Exponential backoff
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
    }
  }, [context])

  const handleError = useCallback((error: Event) => {
    console.error('WebSocket error:', error)
    context.setWebSocketConnected(false)
  }, [context])

  const connect = useCallback((url: string = 'ws://localhost:8000/ws') => {
    try {
      console.log('Connecting to WebSocket:', url)
      wsRef.current = new WebSocket(url)
      wsRef.current.onopen = handleOpen
      wsRef.current.onmessage = handleMessage
      wsRef.current.onclose = handleClose
      wsRef.current.onerror = handleError
    } catch (error) {
      console.error('WebSocket connection error:', error)
      context.setWebSocketConnected(false)
    }
  }, [handleOpen, handleMessage, handleClose, handleError, context])

  // Connect on mount
  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [])

  return {
    isConnected: context.isWebSocketConnected,
    send,
    startInterview,
    pauseInterview,
    stopInterview,
    disconnect
  }
}

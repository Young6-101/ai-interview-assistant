import { useState, useCallback, useRef, useEffect } from 'react'

export interface AudioBlock {
  id: string
  speaker: 'HR' | 'CANDIDATE'
  transcript: string
  timestamp: number
}

export interface PartialTranscript {
  id: string
  speaker: 'HR' | 'CANDIDATE'
  text: string
  timestamp: number
}

interface UseAudioCaptureReturn {
  isRecording: boolean
  error: string | null
  startHrRecording: () => Promise<void>
  stopHrRecording: () => void
  startCandidateRecording: (screenStream: MediaStream) => Promise<void>
  stopCandidateRecording: () => void
  setAssemblyAIToken: (token: string) => void
}

/**
 * Hook for audio capture and transcription
 * Based on reference/audio-capture-new.js
 * 
 * Features:
 * - 16kHz audio capture
 * - AssemblyAI real-time transcription
 * - Block-based transcript (3-second silence = new block)
 * - Dual HR + Candidate audio streams
 * - Real-time partial updates for live display
 */
export const useAudioCapture = (
  onTranscript?: (block: AudioBlock) => void,
  onPartialTranscript?: (partial: PartialTranscript) => void
): UseAudioCaptureReturn => {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // HR Audio state
  const hrMicRef = useRef<any>(null)
  const hrWsRef = useRef<WebSocket | null>(null)
  const hrBlockIdRef = useRef<string>('')
  const hrBlockTranscriptRef = useRef<string>('')
  const hrBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hrBlockSentRef = useRef<boolean>(false) // Prevent duplicate sends
  const hrLastMessageTimeRef = useRef<number>(Date.now()) // Initialize to now

  // Candidate Audio state
  const candidateMicRef = useRef<any>(null)
  const candidateWsRef = useRef<WebSocket | null>(null)
  const candidateBlockIdRef = useRef<string>('')
  const candidateBlockTranscriptRef = useRef<string>('')
  const candidateBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const candidateBlockSentRef = useRef<boolean>(false) // Prevent duplicate sends
  const candidateLastMessageTimeRef = useRef<number>(Date.now()) // Initialize to now

  // Configuration
  const assemblyAITokenRef = useRef<string>('')
  const lastBlockTimeRef = useRef<number>(0)

  // ✅ Use refs to store callbacks to avoid stale closure issues in WebSocket handlers
  const onTranscriptRef = useRef(onTranscript)
  const onPartialTranscriptRef = useRef(onPartialTranscript)
  
  // Keep refs updated
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onPartialTranscriptRef.current = onPartialTranscript
  }, [onTranscript, onPartialTranscript])

  const setAssemblyAIToken = useCallback((token: string) => {
    assemblyAITokenRef.current = token
    console.log('AssemblyAI token set')
  }, [])

  // Create microphone with audio worklet processing
  const createMicrophone = useCallback(() => {
    let stream: MediaStream
    let audioContext: AudioContext
    let audioWorkletNode: AudioWorkletNode
    let source: MediaStreamAudioSourceNode
    let audioBufferQueue = new Int16Array(0)

    function mergeBuffers(lhs: Int16Array, rhs: Int16Array): any {
      const merged = new Int16Array(lhs.length + rhs.length)
      merged.set(lhs, 0)
      merged.set(rhs, lhs.length)
      return merged
    }

    return {
      async requestPermission() {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      },
      async startRecording(onAudioCallback: (data: Uint8Array) => void) {
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        }

        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
          latencyHint: 'balanced'
        })

        source = audioContext.createMediaStreamSource(stream)

        try {
          await audioContext.audioWorklet.addModule('/audio-processor.js')
          audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor')

          audioWorkletNode.port.onmessage = (event) => {
            const currentBuffer = new Int16Array(event.data.audio_data)
            audioBufferQueue = mergeBuffers(audioBufferQueue, currentBuffer)

            const bufferDuration = (audioBufferQueue.length / audioContext.sampleRate) * 1000

            if (bufferDuration >= 100) {
              const totalSamples = Math.floor(audioContext.sampleRate * 0.1)
              const finalBuffer = new Uint8Array(
                audioBufferQueue.subarray(0, totalSamples).buffer
              )
              audioBufferQueue = audioBufferQueue.subarray(totalSamples)

              if (onAudioCallback) onAudioCallback(finalBuffer)
            }
          }

          source.connect(audioWorkletNode)
          audioWorkletNode.connect(audioContext.destination)
          console.log('✅ Audio worklet connected')
        } catch (workletError) {
          console.warn('AudioWorklet not available, using basic capture:', workletError)
          source.connect(audioContext.destination)
        }
      },
      stopRecording() {
        try {
          stream?.getTracks().forEach((track) => track.stop())
          if (audioContext && audioContext.state !== 'closed') {
            audioContext.close()
          }
          audioBufferQueue = new Int16Array(0)
        } catch (e) {
          console.warn('Error stopping recording:', e)
        }
      }
    }
  }, [])

  // Create candidate microphone (from screen stream)
  const createCandidateMicrophone = useCallback((providedStream: MediaStream) => {
    let audioContext: AudioContext
    let audioWorkletNode: AudioWorkletNode
    let source: MediaStreamAudioSourceNode
    let audioBufferQueue = new Int16Array(0)

    function mergeBuffers(lhs: Int16Array, rhs: Int16Array): any {
      const merged = new Int16Array(lhs.length + rhs.length)
      merged.set(lhs, 0)
      merged.set(rhs, lhs.length)
      return merged
    }

    return {
      async startRecording(onAudioCallback: (data: Uint8Array) => void) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
          latencyHint: 'balanced'
        })

        source = audioContext.createMediaStreamSource(providedStream)

        try {
          await audioContext.audioWorklet.addModule('/audio-processor.js')
          audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor')

          audioWorkletNode.port.onmessage = (event) => {
            const currentBuffer = new Int16Array(event.data.audio_data)
            audioBufferQueue = mergeBuffers(audioBufferQueue, currentBuffer)

            const bufferDuration = (audioBufferQueue.length / audioContext.sampleRate) * 1000

            if (bufferDuration >= 100) {
              const totalSamples = Math.floor(audioContext.sampleRate * 0.1)
              const finalBuffer = new Uint8Array(
                audioBufferQueue.subarray(0, totalSamples).buffer
              )
              audioBufferQueue = audioBufferQueue.subarray(totalSamples)

              if (onAudioCallback) onAudioCallback(finalBuffer)
            }
          }

          source.connect(audioWorkletNode)
          audioWorkletNode.connect(audioContext.destination)
          console.log('✅ Candidate audio worklet connected')
        } catch (workletError) {
          console.warn('AudioWorklet not available:', workletError)
          source.connect(audioContext.destination)
        }
      },
      stopRecording() {
        try {
          if (audioContext && audioContext.state !== 'closed') {
            audioContext.close()
          }
          audioBufferQueue = new Int16Array(0)
        } catch (e) {
          console.warn('Error stopping candidate recording:', e)
        }
      }
    }
  }, [])

  const startHrRecording = useCallback(async () => {
    try {
      console.log('Starting HR audio capture...')
      setError(null)

      if (!assemblyAITokenRef.current) {
        throw new Error('AssemblyAI token not configured')
      }

      // Initialize HR block
      hrBlockIdRef.current = `turn_${Date.now()}`
      hrBlockTranscriptRef.current = ''
      hrBlockSentRef.current = false // Reset flag for new session
      hrLastMessageTimeRef.current = Date.now() // Reset message time tracker

      // Create microphone
      hrMicRef.current = createMicrophone()
      await hrMicRef.current.requestPermission()

      // Connect to AssemblyAI
      const endpoint = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&formatted_finals=true&token=${assemblyAITokenRef.current}`
      hrWsRef.current = new WebSocket(endpoint)

      hrWsRef.current.onopen = () => {
        console.log('✅ AssemblyAI WebSocket (HR) connected')
        hrMicRef.current.startRecording((audioChunk: Uint8Array) => {
          if (hrWsRef.current?.readyState === WebSocket.OPEN) {
            hrWsRef.current.send(audioChunk)
          }
        })
      }

      hrWsRef.current.onmessage = (event) => {
        const msg = JSON.parse(event.data)

        if (msg.type !== 'Turn') {
          return
        }

        const { transcript, end_of_turn, turn_is_formatted, turn_order } = msg
        const now = Date.now()
        hrLastMessageTimeRef.current = now

        // Initialize activeTurns tracking if needed
        if (!hrMicRef.current) hrMicRef.current = {}
        if (!hrMicRef.current.activeTurns) hrMicRef.current.activeTurns = {}

        // Update the active turn's text
        if (transcript) {
          hrMicRef.current.activeTurns[turn_order] = transcript
          lastBlockTimeRef.current = now
        }

        // Construct display text: committed block + active parts
        const activeText = Object.values(hrMicRef.current.activeTurns || {}).join(' ')
        const displayTranscript = (hrBlockTranscriptRef.current + ' ' + activeText).trim()

        // ✅ Send partial updates for real-time display (every message)
        if (displayTranscript && onPartialTranscriptRef.current) {
          onPartialTranscriptRef.current({
            id: hrBlockIdRef.current,
            speaker: 'HR',
            text: displayTranscript,
            timestamp: now
          })
        }

        // ✅ Send final transcript when turn is formatted (finalized)
        if (end_of_turn && turn_is_formatted && displayTranscript && !hrBlockSentRef.current) {
          hrBlockSentRef.current = true
          
          // Send only once per turn
          if (onTranscriptRef.current) {
            onTranscriptRef.current({
              id: hrBlockIdRef.current,
              speaker: 'HR',
              transcript: displayTranscript,
              timestamp: now
            })
          }

          // Reset for next turn - clear accumulated text to prevent duplication
          hrMicRef.current.activeTurns = {}
          hrBlockTranscriptRef.current = ''  // ✅ Clear accumulated text
          hrBlockIdRef.current = `turn_${Date.now()}`
          hrBlockSentRef.current = false
        }
      }

      hrWsRef.current.onerror = (err) => {
        console.error('HR WebSocket error:', err)
        setError('HR Audio connection failed')
      }

      setIsRecording(true)
    } catch (err: any) {
      const msg = err.message || 'Failed to start HR audio'
      console.error(msg, err)
      setError(msg)
    }
  }, [createMicrophone])

  const stopHrRecording = useCallback(() => {
    // 1. Stop microphone FIRST to prevent more audio from being captured
    if (hrMicRef.current) {
      hrMicRef.current.stopRecording()
      hrMicRef.current = null
    }

    // 2. Close WebSocket to stop sending audio to AssemblyAI
    if (hrWsRef.current) {
      try {
        if (hrWsRef.current.readyState === WebSocket.OPEN) {
          hrWsRef.current.close()
        }
      } catch (e) {
        console.warn('Error closing HR WebSocket:', e)
      }
      hrWsRef.current = null
    }

    // 3. Clear any pending timers
    if (hrBlockTimerRef.current) {
      clearTimeout(hrBlockTimerRef.current)
      hrBlockTimerRef.current = null
    }

    // 4. Send final block if exists
    if (hrBlockTranscriptRef.current.trim() && onTranscriptRef.current) {
      onTranscriptRef.current({
        id: hrBlockIdRef.current,
        speaker: 'HR',
        transcript: hrBlockTranscriptRef.current,
        timestamp: Date.now()
      })
    }

    console.log('✅ HR audio capture stopped')
  }, [])

  const startCandidateRecording = useCallback(
    async (screenStream: MediaStream) => {
      try {
        console.log('Starting Candidate audio capture...')

        if (!assemblyAITokenRef.current) {
          throw new Error('AssemblyAI token not configured')
        }

        // Initialize Candidate block
        candidateBlockIdRef.current = `turn_${Date.now()}`
        candidateBlockTranscriptRef.current = ''
        candidateBlockSentRef.current = false // Reset flag for new session
        candidateLastMessageTimeRef.current = Date.now() // Reset message time tracker

        // Create candidate microphone from screen stream
        candidateMicRef.current = createCandidateMicrophone(screenStream)

        // Connect to AssemblyAI FIRST before starting recording
        const endpoint = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&formatted_finals=true&token=${assemblyAITokenRef.current}`
        candidateWsRef.current = new WebSocket(endpoint)

        candidateWsRef.current.onopen = () => {
          console.log('✅ AssemblyAI WebSocket (Candidate) connected')
          // NOW start sending audio after WebSocket is ready
          candidateMicRef.current.startRecording((audioChunk: Uint8Array) => {
            if (candidateWsRef.current?.readyState === WebSocket.OPEN) {
              candidateWsRef.current.send(audioChunk)
            }
          })
        }

        candidateWsRef.current.onmessage = (event) => {
          const msg = JSON.parse(event.data)

          if (msg.type !== 'Turn') {
            return
          }

          const { transcript, end_of_turn, turn_is_formatted, turn_order } = msg
          const now = Date.now()
          candidateLastMessageTimeRef.current = now

          // Initialize activeTurns tracking if needed
          if (!candidateMicRef.current) candidateMicRef.current = {}
          if (!candidateMicRef.current.activeTurns) candidateMicRef.current.activeTurns = {}

          // Update the active turn's text
          if (transcript) {
            candidateMicRef.current.activeTurns[turn_order] = transcript
            lastBlockTimeRef.current = now
          }

          // Construct display text: committed block + active parts
          const activeText = Object.values(candidateMicRef.current.activeTurns || {}).join(' ')
          const displayTranscript = (candidateBlockTranscriptRef.current + ' ' + activeText).trim()

          // ✅ Send partial updates for real-time display (every message)
          if (displayTranscript && onPartialTranscriptRef.current) {
            onPartialTranscriptRef.current({
              id: candidateBlockIdRef.current,
              speaker: 'CANDIDATE',
              text: displayTranscript,
              timestamp: now
            })
          }

          // ✅ Send final transcript when turn is formatted (finalized)
          if (end_of_turn && turn_is_formatted && displayTranscript && !candidateBlockSentRef.current) {
            candidateBlockSentRef.current = true
            
            // Send only once per turn
            if (onTranscriptRef.current) {
              onTranscriptRef.current({
                id: candidateBlockIdRef.current,
                speaker: 'CANDIDATE',
                transcript: displayTranscript,
                timestamp: now
              })
            }

            // Reset for next turn - clear accumulated text to prevent duplication
            candidateMicRef.current.activeTurns = {}
            candidateBlockTranscriptRef.current = ''  // ✅ Clear accumulated text
            candidateBlockIdRef.current = `turn_${Date.now()}`
            candidateBlockSentRef.current = false
          }
        }

        console.log('✅ Candidate audio capture started')
      } catch (err: any) {
        const msg = err.message || 'Failed to start candidate audio'
        console.error(msg, err)
        setError(msg)
      }
    },
    [createCandidateMicrophone]
  )

  const stopCandidateRecording = useCallback(() => {
    // 1. Stop microphone FIRST to prevent more audio from being captured
    if (candidateMicRef.current) {
      candidateMicRef.current.stopRecording()
      candidateMicRef.current = null
    }

    // 2. Close WebSocket to stop sending audio to AssemblyAI
    if (candidateWsRef.current) {
      try {
        if (candidateWsRef.current.readyState === WebSocket.OPEN) {
          candidateWsRef.current.close()
        }
      } catch (e) {
        console.warn('Error closing Candidate WebSocket:', e)
      }
      candidateWsRef.current = null
    }

    // 3. Clear any pending timers
    if (candidateBlockTimerRef.current) {
      clearTimeout(candidateBlockTimerRef.current)
      candidateBlockTimerRef.current = null
    }

    // 4. Send final block if exists
    if (candidateBlockTranscriptRef.current.trim() && onTranscriptRef.current) {
      onTranscriptRef.current({
        id: candidateBlockIdRef.current,
        speaker: 'CANDIDATE',
        transcript: candidateBlockTranscriptRef.current,
        timestamp: Date.now()
      })
    }

    console.log('✅ Candidate audio capture stopped')
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHrRecording()
      stopCandidateRecording()
    }
  }, [stopHrRecording, stopCandidateRecording])

  return {
    isRecording,
    error,
    startHrRecording,
    stopHrRecording,
    startCandidateRecording,
    stopCandidateRecording,
    setAssemblyAIToken
  }
}

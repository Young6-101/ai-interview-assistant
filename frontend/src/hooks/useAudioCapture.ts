import { useState, useCallback, useRef, useEffect } from 'react'

export interface AudioBlock {
  id: string
  speaker: 'HR' | 'CANDIDATE'
  transcript: string
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
 */
export const useAudioCapture = (onTranscript?: (block: AudioBlock) => void): UseAudioCaptureReturn => {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // HR Audio state
  const hrMicRef = useRef<any>(null)
  const hrWsRef = useRef<WebSocket | null>(null)
  const hrBlockIdRef = useRef<string>('')
  const hrBlockTranscriptRef = useRef<string>('')
  const hrBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Candidate Audio state
  const candidateMicRef = useRef<any>(null)
  const candidateWsRef = useRef<WebSocket | null>(null)
  const candidateBlockIdRef = useRef<string>('')
  const candidateBlockTranscriptRef = useRef<string>('')
  const candidateBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Configuration
  const assemblyAITokenRef = useRef<string>('')
  const lastBlockTimeRef = useRef<number>(0)

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
        } catch (e) {
          console.warn('Error stopping recording:', e)
        }
        audioBufferQueue = new Int16Array(0)
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

    function float32ToInt16(float32Array: Float32Array): Int16Array {
      const int16Array = new Int16Array(float32Array.length)
      for (let i = 0; i < float32Array.length; i++) {
        int16Array[i] = float32Array[i] < 0 ? float32Array[i] * 0x8000 : float32Array[i] * 0x7fff
      }
      return int16Array
    }

    return {
      async startRecording(onAudioCallback: (data: Uint8Array) => void) {
        try {
          audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
            sampleRate: 16000,
            latencyHint: 'balanced'
          })

          source = audioContext.createMediaStreamSource(providedStream)

          // Use ScriptProcessorNode as fallback (deprecated but reliable)
          const processor = audioContext.createScriptProcessor(4096, 1, 1)

          processor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0)
            const int16Data = float32ToInt16(inputData)
            audioBufferQueue = mergeBuffers(audioBufferQueue, int16Data)

            const bufferDuration = (audioBufferQueue.length / 16000) * 1000

            if (bufferDuration >= 100) {
              const totalSamples = Math.floor(16000 * 0.1)
              const finalBuffer = new Uint8Array(
                audioBufferQueue.subarray(0, totalSamples).buffer
              )
              audioBufferQueue = audioBufferQueue.subarray(totalSamples)

              if (onAudioCallback) onAudioCallback(finalBuffer)
            }
          }

          source.connect(processor)
          processor.connect(audioContext.destination)
          console.log('✅ Candidate audio capture started (ScriptProcessor)')
        } catch (error) {
          console.error('Audio capture failed:', error)
          throw error
        }
      },
      stopRecording() {
        try {
          if (audioContext && audioContext.state !== 'closed') {
            audioContext.close()
          }
        } catch (e) {
          console.warn('Error stopping candidate recording:', e)
        }
        audioBufferQueue = new Int16Array(0)
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

        const { transcript, end_of_turn, turn_is_formatted } = msg
        const now = Date.now()

        // 3-second pause detection: start new block
        if (now - lastBlockTimeRef.current >= 3000 && hrBlockTranscriptRef.current.trim()) {
          console.log('🔄 3-second pause detected (HR). Block completed.')

          // Send previous block
          if (onTranscript) {
            onTranscript({
              id: hrBlockIdRef.current,
              speaker: 'HR',
              transcript: hrBlockTranscriptRef.current,
              timestamp: Date.now()
            })
          }

          // Start new block
          hrBlockIdRef.current = `turn_${now}`
          hrBlockTranscriptRef.current = ''

          if (hrBlockTimerRef.current) {
            clearTimeout(hrBlockTimerRef.current)
          }
        }

        // Update transcript
        if (transcript) {
          hrBlockTranscriptRef.current = transcript
        }

        // Finalized turn
        if (end_of_turn && turn_is_formatted) {
          lastBlockTimeRef.current = now

          // Schedule block completion timer
          if (hrBlockTimerRef.current) {
            clearTimeout(hrBlockTimerRef.current)
          }
          hrBlockTimerRef.current = setTimeout(() => {
            if (hrBlockTranscriptRef.current.trim()) {
              console.log('Block completion timer fired (HR)')
              if (onTranscript) {
                onTranscript({
                  id: hrBlockIdRef.current,
                  speaker: 'HR',
                  transcript: hrBlockTranscriptRef.current,
                  timestamp: Date.now()
                })
              }
              hrBlockTranscriptRef.current = ''
              hrBlockIdRef.current = `turn_${Date.now()}`
            }
          }, 3000)
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
  }, [createMicrophone, onTranscript])

  const stopHrRecording = useCallback(() => {
    if (hrWsRef.current) {
      hrWsRef.current.close()
      hrWsRef.current = null
    }
    if (hrMicRef.current) {
      hrMicRef.current.stopRecording()
    }
    if (hrBlockTimerRef.current) {
      clearTimeout(hrBlockTimerRef.current)
    }

    // Send final block if exists
    if (hrBlockTranscriptRef.current.trim() && onTranscript) {
      onTranscript({
        id: hrBlockIdRef.current,
        speaker: 'HR',
        transcript: hrBlockTranscriptRef.current,
        timestamp: Date.now()
      })
    }

    console.log('HR audio capture stopped')
  }, [onTranscript])

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

        // Create candidate microphone from screen stream
        candidateMicRef.current = createCandidateMicrophone(screenStream)
        await candidateMicRef.current.startRecording((audioChunk: Uint8Array) => {
          if (candidateWsRef.current?.readyState === WebSocket.OPEN) {
            candidateWsRef.current.send(audioChunk)
          }
        })

        // Connect to AssemblyAI
        const endpoint = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&formatted_finals=true&token=${assemblyAITokenRef.current}`
        candidateWsRef.current = new WebSocket(endpoint)

        candidateWsRef.current.onopen = () => {
          console.log('✅ AssemblyAI WebSocket (Candidate) connected')
        }

        candidateWsRef.current.onmessage = (event) => {
          const msg = JSON.parse(event.data)

          if (msg.type !== 'Turn') {
            return
          }

          const { transcript, end_of_turn, turn_is_formatted } = msg
          const now = Date.now()

          // Similar logic as HR
          if (transcript) {
            candidateBlockTranscriptRef.current = transcript
          }

          if (end_of_turn && turn_is_formatted) {
            // Send candidate transcript
            if (onTranscript) {
              onTranscript({
                id: candidateBlockIdRef.current,
                speaker: 'CANDIDATE',
                transcript: candidateBlockTranscriptRef.current,
                timestamp: Date.now()
              })
            }

            candidateBlockTranscriptRef.current = ''
            candidateBlockIdRef.current = `turn_${now}`
          }
        }

        console.log('✅ Candidate audio capture started')
      } catch (err: any) {
        const msg = err.message || 'Failed to start candidate audio'
        console.error(msg, err)
        setError(msg)
      }
    },
    [createCandidateMicrophone, onTranscript]
  )

  const stopCandidateRecording = useCallback(() => {
    if (candidateWsRef.current) {
      candidateWsRef.current.close()
      candidateWsRef.current = null
    }
    if (candidateMicRef.current) {
      candidateMicRef.current.stopRecording()
    }
    if (candidateBlockTimerRef.current) {
      clearTimeout(candidateBlockTimerRef.current)
    }

    console.log('Candidate audio capture stopped')
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

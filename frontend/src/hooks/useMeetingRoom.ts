import { useState, useCallback, useRef, useEffect } from 'react'

export interface UseMeetingRoomReturn {
  screenStream: MediaStream | null
  isSharing: boolean
  error: string | null
  selectMeetingRoom: () => Promise<void>
  stopMeetingRoom: () => void
  reselectMeetingRoom: () => Promise<void>
}

/**
 * Hook for managing screen sharing (Meeting Room).
 * Refactored to use Refs for hardware control to avoid stale closures 
 * and infinite re-render loops.
 */
export const useMeetingRoom = (): UseMeetingRoomReturn => {
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Use a Ref to keep track of the stream for the 'physical' stop logic
  // This allows stopMeetingRoom to be a stable function with 0 dependencies
  const streamRef = useRef<MediaStream | null>(null)

  /**
   * Physically stops all tracks in the current stream.
   */
  const stopMeetingRoom = useCallback(() => {
    if (streamRef.current) {
      console.log('Stopping all media tracks...')
      streamRef.current.getTracks().forEach((track) => {
        track.stop()
        track.enabled = false
      })
      streamRef.current = null
    }
    setScreenStream(null)
    setIsSharing(false)
  }, []) // Zero dependencies = Never changes

  /**
   * Opens the browser screen picker.
   */
  const selectMeetingRoom = useCallback(async (): Promise<void> => {
    try {
      console.log('Requesting screen capture...')
      setError(null)

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      streamRef.current = stream
      setScreenStream(stream)
      setIsSharing(true)

      // Listen for the "Stop Sharing" button in the browser UI
      stream.getVideoTracks()[0].onended = () => {
        console.log('Screen sharing ended by browser UI')
        stopMeetingRoom()
      }

      console.log('✅ Screen capture active')
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Permission denied. Please allow screen sharing.')
      } else {
        setError(err.message || 'Failed to capture screen')
      }
      console.error('Screen capture error:', err)
      throw err
    }
  }, [stopMeetingRoom])

  /**
   * Properly restarts the meeting room capture.
   * Includes a small delay to ensure hardware is released.
   */
  const reselectMeetingRoom = useCallback(async () => {
    console.log('Restarting meeting room selection...')
    stopMeetingRoom()
    
    // Give the browser 150ms to release the previous stream hardware
    await new Promise(resolve => setTimeout(resolve, 150))
    
    await selectMeetingRoom()
  }, [selectMeetingRoom, stopMeetingRoom])

  /**
   * Cleanup: Ensure tracks are stopped if the component is unmounted
   */
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  return {
    screenStream,
    isSharing,
    error,
    selectMeetingRoom,
    stopMeetingRoom,
    reselectMeetingRoom
  }
}
import { useState, useCallback } from 'react'

export interface UseMeetingRoomReturn {
  screenStream: MediaStream | null
  isSharing: boolean
  error: string | null
  selectMeetingRoom: () => Promise<void>
  stopMeetingRoom: () => void
  reselectMeetingRoom: () => Promise<void>
}

/**
 * Hook for managing screen sharing (Meeting Room)
 * Based on reference/meeting-room.js
 */
export const useMeetingRoom = (): UseMeetingRoomReturn => {
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectMeetingRoom = useCallback(async (): Promise<void> => {
    try {
      console.log('Starting screen share selection...')
      setError(null)

      // Use getDisplayMedia to show browser's built-in screen picker
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } as any,
        audio: true // Also capture audio from the meeting room
      })

      console.log('✅ Screen share started successfully')
      setScreenStream(stream)
      setIsSharing(true)

      // Listen for stream end
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        console.log('Screen sharing ended')
        stopMeetingRoom()
      })
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to select meeting room'
      console.error('Error selecting meeting room:', err)
      setError(errorMsg)
      throw err
    }
  }, [])

  const stopMeetingRoom = useCallback(() => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop())
      setScreenStream(null)
    }
    setIsSharing(false)
    console.log('Meeting room sharing stopped')
  }, [screenStream])

  const reselectMeetingRoom = useCallback(async () => {
    stopMeetingRoom()
    await selectMeetingRoom()
  }, [selectMeetingRoom, stopMeetingRoom])

  return {
    screenStream,
    isSharing,
    error,
    selectMeetingRoom,
    stopMeetingRoom,
    reselectMeetingRoom
  }
}

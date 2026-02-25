
import { useState, useRef, useCallback } from 'react';

interface UseMicrophoneStreamOptions {
    onMicAudioData: (base64Data: string) => void;      // HR audio (microphone)
    onScreenAudioData: (base64Data: string) => void;   // Candidate audio (screen share)
    onError: (error: string) => void;
}

// Helper function to convert Float32 to PCM16 Base64
function float32ToPCM16Base64(inputData: Float32Array): string {
    const buffer = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    let binary = '';
    const bytes = new Uint8Array(buffer.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export const useMicrophoneStream = ({ onMicAudioData, onScreenAudioData, onError }: UseMicrophoneStreamOptions) => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

    // Mic refs
    const micStreamRef = useRef<MediaStream | null>(null);
    const micContextRef = useRef<AudioContext | null>(null);
    const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    // Screen refs  
    const screenStreamRef = useRef<MediaStream | null>(null);
    const screenContextRef = useRef<AudioContext | null>(null);
    const screenProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const screenSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    // Callback refs to avoid stale closures
    const onMicAudioDataRef = useRef(onMicAudioData);
    const onScreenAudioDataRef = useRef(onScreenAudioData);
    onMicAudioDataRef.current = onMicAudioData;
    onScreenAudioDataRef.current = onScreenAudioData;

    const startStream = useCallback(async () => {
        try {
            if (isStreaming) return;

            // Get microphone stream
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 24000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            micStreamRef.current = stream;

            // Create audio context for mic
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 24000,
            });
            micContextRef.current = audioContext;

            const micSource = audioContext.createMediaStreamSource(stream);
            micSourceRef.current = micSource;

            // Create processor for mic audio
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            micProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const base64String = float32ToPCM16Base64(inputData);
                onMicAudioDataRef.current(base64String);
            };

            // Connect: mic -> processor -> silent output
            micSource.connect(processor);
            const silentGain = audioContext.createGain();
            silentGain.gain.value = 0;
            processor.connect(silentGain);
            silentGain.connect(audioContext.destination);

            setIsStreaming(true);
            console.log('🎤 Mic stream started (HR audio)');

        } catch (err: any) {
            console.error('Mic Error:', err);
            onError(err.message || 'Failed to access microphone');
        }
    }, [isStreaming, onError]);

    const stopStream = useCallback(() => {
        // Stop mic
        if (micProcessorRef.current) {
            micProcessorRef.current.disconnect();
            micProcessorRef.current = null;
        }
        if (micSourceRef.current) {
            micSourceRef.current.disconnect();
            micSourceRef.current = null;
        }
        if (micContextRef.current) {
            micContextRef.current.close();
            micContextRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
        }
        setIsStreaming(false);

        // Stop screen share
        if (screenProcessorRef.current) {
            screenProcessorRef.current.disconnect();
            screenProcessorRef.current = null;
        }
        if (screenSourceRef.current) {
            screenSourceRef.current.disconnect();
            screenSourceRef.current = null;
        }
        if (screenContextRef.current) {
            screenContextRef.current.close();
            screenContextRef.current = null;
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => track.stop());
            screenStreamRef.current = null;
            setScreenStream(null);
            setIsSharing(false);
        }
    }, []);

    const startScreenShare = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            
            screenStreamRef.current = stream;
            setScreenStream(stream);
            setIsSharing(true);

            // Check if screen share has audio
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                // Create separate audio context for screen audio
                const screenContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                    sampleRate: 24000,
                });
                screenContextRef.current = screenContext;

                const screenSource = screenContext.createMediaStreamSource(
                    new MediaStream(audioTracks)
                );
                screenSourceRef.current = screenSource;

                // Create processor for screen audio
                const screenProcessor = screenContext.createScriptProcessor(4096, 1, 1);
                screenProcessorRef.current = screenProcessor;

                screenProcessor.onaudioprocess = (e) => {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const base64String = float32ToPCM16Base64(inputData);
                    onScreenAudioDataRef.current(base64String);
                };

                // Connect: screen -> processor -> silent output
                screenSource.connect(screenProcessor);
                const silentGain = screenContext.createGain();
                silentGain.gain.value = 0;
                screenProcessor.connect(silentGain);
                silentGain.connect(screenContext.destination);

                console.log('🔊 Screen audio stream started (Candidate audio)');
            } else {
                console.warn('⚠️ Screen share has no audio track. Make sure to check "Share audio" in the picker.');
            }

            // If user stops sharing via browser UI
            stream.getVideoTracks()[0].onended = () => {
                if (screenProcessorRef.current) {
                    screenProcessorRef.current.disconnect();
                    screenProcessorRef.current = null;
                }
                if (screenSourceRef.current) {
                    screenSourceRef.current.disconnect();
                    screenSourceRef.current = null;
                }
                if (screenContextRef.current) {
                    screenContextRef.current.close();
                    screenContextRef.current = null;
                }
                screenStreamRef.current = null;
                setIsSharing(false);
                setScreenStream(null);
            };

        } catch (err: any) {
            console.error('Screen Share Error:', err);
            onError(err.message || 'Failed to share screen');
        }
    }, [onError]);

    return {
        startStream,
        stopStream,
        isStreaming,
        isSharing,
        screenStream,
        startScreenShare
    };
};

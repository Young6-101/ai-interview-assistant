
import { useState, useRef, useCallback } from 'react';

interface UseMicrophoneStreamOptions {
    onAudioData: (base64Data: string) => void;
    onError: (error: string) => void;
}

export const useMicrophoneStream = ({ onAudioData, onError }: UseMicrophoneStreamOptions) => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

    const micStreamRef = useRef<MediaStream | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const startStream = useCallback(async () => {
        try {
            if (isStreaming) return;

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 24000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            micStreamRef.current = stream;

            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 24000,
            });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;

            // Use ScriptProcessor for raw PCM capture (AudioWorklet is better but complex for this quick fix)
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const buffer = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Safe Base64 encoding
                let binary = '';
                const bytes = new Uint8Array(buffer.buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64String = window.btoa(binary);

                onAudioData(base64String);
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            setIsStreaming(true);
            console.log('🎤 Mic stream started');

        } catch (err: any) {
            console.error('Mic Error:', err);
            onError(err.message || 'Failed to access microphone');
        }
    }, [isStreaming, onAudioData, onError]);

    const stopStream = useCallback(() => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach(track => track.stop());
            micStreamRef.current = null;
        }
        setIsStreaming(false);

        // Stop Screen Share too if active
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            setScreenStream(null);
            setIsSharing(false);
        }
    }, [screenStream]);

    const startScreenShare = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            setScreenStream(stream);
            setIsSharing(true);

            // If user stops sharing via browser UI
            stream.getVideoTracks()[0].onended = () => {
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

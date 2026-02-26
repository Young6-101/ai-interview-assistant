
import { useState, useEffect, useRef, useCallback } from 'react';

interface UseWebSocketOptions {
    url: string;
    token: string;
    onMessage: (message: any) => void;
}

export const useWebSocketLite = ({ url, token, onMessage }: UseWebSocketOptions) => {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const onMessageRef = useRef(onMessage);
    
    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN || 
            wsRef.current?.readyState === WebSocket.CONNECTING) {
            return;
        }

        const fullUrl = `${url}?token=${token}`;

        const socket = new WebSocket(fullUrl);

        socket.onopen = () => {
            setIsConnected(true);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessageRef.current(data);
            } catch (e) {
                console.error('WS Parse Error:', e);
            }
        };

        socket.onclose = () => {
            setIsConnected(false);
            wsRef.current = null;
        };

        socket.onerror = (error) => {
            console.error('WS Error:', error);
        };

        wsRef.current = socket;
    }, [url, token]); // Removed onMessage from dependencies

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
            setIsConnected(false);
        }
    }, []);

    const sendMessage = useCallback((data: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            wsRef.current.send(payload);
        } else {
            console.warn('WS not connected, cannot send:', data);
        }
    }, []);

    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    return { isConnected, sendMessage, disconnect, connect };
};

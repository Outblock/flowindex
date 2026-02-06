import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WSStatusContext, WSMessageContext } from '../contexts/WebSocketContext';

const WS_URL = window.location.protocol === 'https:'
    ? `wss://${window.location.host}/ws`
    : `ws://${window.location.host}/ws`;

export function WebSocketProvider({ children }) {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const listenersRef = useRef(new Set());
    const connectRef = useRef(null);

    const notify = useCallback((payload) => {
        listenersRef.current.forEach((listener) => {
            try {
                listener(payload);
            } catch (err) {
                console.error('WebSocket listener error:', err);
            }
        });
    }, []);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                notify(data);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };

        ws.onclose = () => {
            setIsConnected(false);
            reconnectTimeoutRef.current = setTimeout(() => {
                if (connectRef.current) {
                    connectRef.current();
                }
            }, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            ws.close();
        };
    }, [notify]);

    useEffect(() => {
        connectRef.current = connect;
    }, [connect]);

    useEffect(() => {
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [connect]);

    const subscribe = useCallback((listener) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    const statusValue = useMemo(() => ({ isConnected }), [isConnected]);
    const messageValue = useMemo(() => ({ subscribe }), [subscribe]);

    return (
        <WSStatusContext.Provider value={statusValue}>
            <WSMessageContext.Provider value={messageValue}>
                {children}
            </WSMessageContext.Provider>
        </WSStatusContext.Provider>
    );
}

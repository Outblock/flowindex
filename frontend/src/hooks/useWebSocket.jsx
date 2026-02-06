import { useContext, useEffect, useState } from 'react';
import { WSStatusContext, WSMessageContext } from '../contexts/WebSocketContext';

export function useWebSocketStatus() {
  return useContext(WSStatusContext);
}

export function useWebSocketMessages() {
  const { subscribe } = useContext(WSMessageContext);
  const [lastMessage, setLastMessage] = useState(null);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe(setLastMessage);
  }, [subscribe]);

  return { lastMessage };
}

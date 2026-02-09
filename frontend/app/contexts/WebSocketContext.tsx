import { createContext } from 'react';

export const WSStatusContext = createContext({ isConnected: false });
export const WSMessageContext = createContext({ subscribe: (_listener: (data: any) => void) => () => { } });

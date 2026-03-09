import { useState, useEffect, useRef, useCallback } from 'react';
import type { FlowNetwork } from './networks';

export type EmulatorStatus = 'connected' | 'disconnected' | 'checking';

/**
 * Poll the emulator REST API to determine if it's running.
 * Only active when network === 'emulator'.
 */
export function useEmulatorStatus(network: FlowNetwork) {
  const [status, setStatus] = useState<EmulatorStatus>('checking');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    if (network !== 'emulator') return;
    try {
      const res = await fetch('http://localhost:8888/v1/blocks?height=sealed', {
        signal: AbortSignal.timeout(3000),
      });
      setStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    }
  }, [network]);

  useEffect(() => {
    if (network !== 'emulator') {
      setStatus('checking');
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    // Initial check
    check();

    // Poll every 5 seconds
    timerRef.current = setInterval(check, 5000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [network, check]);

  return { status, recheck: check };
}

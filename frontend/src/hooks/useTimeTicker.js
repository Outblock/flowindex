import { useEffect, useState } from 'react';

export function useTimeTicker(intervalMs = 20000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}


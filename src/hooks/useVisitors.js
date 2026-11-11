import { useEffect, useState } from 'react';

// Visitors in the last 24 hours, counted by our own server (no IP or user agent is stored).
// Returns null until loaded or when the endpoint is unavailable.
const ENDPOINT = `${import.meta.env.VITE_API_BASE || '/api'}/visitors`;

export function useVisitors() {
  const [visitors, setVisitors] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ENDPOINT, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Number.isFinite(data?.visitors24h)) setVisitors(data.visitors24h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return visitors;
}

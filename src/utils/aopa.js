import { useEffect, useState } from 'react';

// AOPA publishes a small airport-diagram GIF for most U.S. airports, keyed by the FAA identifier ("GAI", "7B2").
// It is used only as a fallback link when the FAA d-TPP data has no airport diagram for the airport.
const AOPA_DIAGRAM_BASE = 'https://www.aopa.org/ustprocs/airportgraphics/gif';

// FAA identifier -> AOPA thumbnail URL. K-prefixed ICAO codes map to the FAA code without the K; codes that contain a
// digit are already FAA identifiers. Anything else (other countries, Alaska/Hawaii/territory ICAO codes) is skipped,
// because stripping a letter would not reliably give the FAA identifier.
export function aopaDiagramUrl(airport) {
  const code = String(airport?.airport_code || '').trim().toUpperCase();
  if (!code || (airport?.country && airport.country !== 'US')) return '';

  let faaId = '';
  if (/^K[A-Z]{3}$/.test(code)) faaId = code.slice(1);
  else if (/^[A-Z0-9]{3,4}$/.test(code) && /\d/.test(code)) faaId = code;
  else return '';

  return `${AOPA_DIAGRAM_BASE}/tn_${faaId}_tif.gif`;
}

// Not every airport has an AOPA diagram (a missing one answers 404), so loading the image tells whether it exists.
const checks = new Map();

export function aopaDiagramExists(url) {
  if (!url) return Promise.resolve(false);
  if (!checks.has(url)) {
    checks.set(url, new Promise((resolve) => {
      const image = new Image();
      const timer = setTimeout(() => resolve(false), 8000);
      image.onload = () => { clearTimeout(timer); resolve(true); };
      image.onerror = () => { clearTimeout(timer); resolve(false); };
      image.src = url;
    }));
  }
  return checks.get(url);
}

// 'checking' while unknown, then the URL when the AOPA diagram exists, or '' when it does not.
export function useAopaDiagramUrl(airport, enabled = true) {
  const url = enabled ? aopaDiagramUrl(airport) : '';
  const [state, setState] = useState({ url, result: url ? 'checking' : '' });

  useEffect(() => {
    if (!url) {
      setState({ url, result: '' });
      return undefined;
    }
    let active = true;
    setState({ url, result: 'checking' });
    aopaDiagramExists(url).then((exists) => {
      if (active) setState({ url, result: exists ? url : '' });
    });
    return () => { active = false; };
  }, [url]);

  return state.url === url ? state.result : (url ? 'checking' : '');
}

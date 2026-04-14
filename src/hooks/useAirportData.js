import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLocationIndex } from '../utils/filtering';

const ENDPOINT = '/.netlify/functions/airport-data';

function isFiniteCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function normalizeRunway(runway) {
  return {
    rwy_id: runway.rwy_id || runway.i || '',
    length: Number(runway.length ?? runway.l ?? 0),
    width: Number(runway.width ?? runway.w ?? 0),
    surface: runway.surface || runway.s || '',
    condition: runway.condition || runway.c || '',
  };
}

function normalizeApproach(approach) {
  return {
    name: approach.name || approach.n || '',
    pdf_url: approach.pdf_url || approach.u || '',
  };
}

function normalizeRunwaySummary(airport) {
  if (airport.runwaySummary) {
    return {
      ASPH: Number(airport.runwaySummary.ASPH || 0),
      CONC: Number(airport.runwaySummary.CONC || 0),
      TURF: Number(airport.runwaySummary.TURF || 0),
      OTHER: Number(airport.runwaySummary.OTHER || 0),
    };
  }

  if (Array.isArray(airport.rm)) {
    return {
      ASPH: Number(airport.rm[0] || 0),
      CONC: Number(airport.rm[1] || 0),
      TURF: Number(airport.rm[2] || 0),
      OTHER: Number(airport.rm[3] || 0),
    };
  }

  return {
    ASPH: 0,
    CONC: 0,
    TURF: 0,
    OTHER: 0,
  };
}

function normalizeApproachSummary(airport) {
  if (airport.approachSummary) {
    return {
      count: Number(airport.approachSummary.count || 0),
      hasRnav: Boolean(airport.approachSummary.hasRnav),
      hasIlsLoc: Boolean(airport.approachSummary.hasIlsLoc),
      hasVorNdb: Boolean(airport.approachSummary.hasVorNdb),
    };
  }

  const bits = Number(airport.ab || 0);
  return {
    count: Number(airport.ac || 0),
    hasRnav: Boolean(bits & 1),
    hasIlsLoc: Boolean(bits & 2),
    hasVorNdb: Boolean(bits & 4),
  };
}

function normalizeBaseAirport(airport) {
  return {
    airport_code: String(airport.airport_code || airport.code || airport.c || '').trim().toUpperCase(),
    airport_name: airport.airport_name || airport.name || airport.n || '',
    city: airport.city || airport.ci || '',
    state: airport.state || airport.s || 'unknown',
    country: airport.country || airport.co || 'US',
    lat: Number(airport.lat ?? airport.la),
    lon: Number(airport.lon ?? airport.lo),
    elevation: Number(airport.elevation ?? airport.e ?? 0),
    airspace: airport.airspace || airport.airspace_class || airport.a || 'G',
    fuel: airport.fuel || airport.fuel_raw || airport.f || 'None',
    runwaySummary: normalizeRunwaySummary(airport),
    approachSummary: normalizeApproachSummary(airport),
    runways: [],
    approaches: [],
    detailsLoaded: false,
  };
}

function normalizeDetailedAirport(airport) {
  const runwaysRaw = Array.isArray(airport.runways)
    ? airport.runways
    : Array.isArray(airport.r)
      ? airport.r
      : [];
  const approachesRaw = Array.isArray(airport.approaches)
    ? airport.approaches
    : Array.isArray(airport.p)
      ? airport.p
      : [];

  return {
    airport_code: String(airport.airport_code || airport.code || airport.c || '').trim().toUpperCase(),
    airport_name: airport.airport_name || airport.name || airport.n || '',
    city: airport.city || airport.ci || '',
    state: airport.state || airport.s || 'unknown',
    country: airport.country || airport.co || 'US',
    airspace: airport.airspace || airport.airspace_class || airport.a || 'G',
    fuel: airport.fuel || airport.fuel_raw || airport.f || 'None',
    remarks: airport.remarks || '',
    runways: runwaysRaw.map(normalizeRunway).filter((runway) => runway.rwy_id),
    approaches: approachesRaw.map(normalizeApproach).filter((approach) => approach.name),
    detailsLoaded: true,
  };
}

export function useAirportData() {
  const [airportData, setAirportData] = useState({});
  const [databaseVersion, setDatabaseVersion] = useState('UNKNOWN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const airportDataRef = useRef({});
  const inflightDetailsRef = useRef(new Set());

  useEffect(() => {
    airportDataRef.current = airportData;
  }, [airportData]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        setError('');

        const response = await fetch(ENDPOINT);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            payload?.details ||
              payload?.error ||
              `HTTP ${response.status}`
          );
        }

        if (cancelled) return;

        const version = payload?.databaseVersion || payload?.database_version || 'UNKNOWN';
        setDatabaseVersion(version);

        const airportsArray = Array.isArray(payload?.airports)
          ? payload.airports
          : Object.entries(payload || {}).map(([airport_code, record]) => ({
              airport_code,
              ...record,
            }));

        const normalized = {};
        let invalidCoordCount = 0;

        airportsArray.forEach((airport) => {
          const baseAirport = normalizeBaseAirport(airport);
          const code = baseAirport.airport_code;
          if (!code) return;

          const lat = Number(baseAirport.lat);
          const lon = Number(baseAirport.lon);

          if (!isFiniteCoord(lat, lon)) {
            invalidCoordCount += 1;
            return;
          }

          normalized[code] = {
            ...baseAirport,
            lat,
            lon,
          };
        });

        console.log('[useAirportData] databaseVersion =', version);
        console.log('[useAirportData] airports payload count =', airportsArray.length);
        console.log('[useAirportData] normalized airport count =', Object.keys(normalized).length);
        console.log('[useAirportData] invalidCoordCount =', invalidCoordCount);

        setAirportData(normalized);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load airport data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadAirportDetails = useCallback(async (codes) => {
    const requestedCodes = [...new Set((Array.isArray(codes) ? codes : [codes])
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean))];

    const codesToFetch = requestedCodes.filter((code) => {
      const airport = airportDataRef.current[code];
      return airport && !airport.detailsLoaded && !inflightDetailsRef.current.has(code);
    });

    if (codesToFetch.length === 0) return;

    codesToFetch.forEach((code) => inflightDetailsRef.current.add(code));

    try {
      const response = await fetch(`${ENDPOINT}?codes=${encodeURIComponent(codesToFetch.join(','))}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      const airportsArray = Array.isArray(payload?.airports) ? payload.airports : [];
      if (airportsArray.length === 0) return;

      setAirportData((current) => {
        const next = { ...current };

        airportsArray.forEach((airport) => {
          const detail = normalizeDetailedAirport(airport);
          const code = detail.airport_code;
          if (!code || !next[code]) return;

          next[code] = {
            ...next[code],
            ...detail,
          };
        });

        return next;
      });
    } catch (err) {
      console.error('[useAirportData] Failed to load airport details', err);
    } finally {
      codesToFetch.forEach((code) => inflightDetailsRef.current.delete(code));
    }
  }, []);

  const locationIndex = useMemo(() => buildLocationIndex(airportData), [airportData]);

  return {
    airportData,
    databaseVersion,
    loading,
    error,
    locationIndex,
    loadAirportDetails,
  };
}

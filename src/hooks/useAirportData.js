import { useEffect, useMemo, useState } from 'react';
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

export function useAirportData() {
  const [airportData, setAirportData] = useState({});
  const [databaseVersion, setDatabaseVersion] = useState('UNKNOWN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
          const code = String(airport.airport_code || airport.code || airport.c || '').trim().toUpperCase();
          if (!code) return;

          const lat = Number(airport.lat ?? airport.la);
          const lon = Number(airport.lon ?? airport.lo);

          if (!isFiniteCoord(lat, lon)) {
            invalidCoordCount += 1;
            return;
          }

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

          normalized[code] = {
            ...airport,
            airport_code: code,
            airport_name: airport.airport_name || airport.name || airport.n || '',
            city: airport.city || airport.ci || '',
            state: airport.state || airport.s || 'unknown',
            country: airport.country || airport.co || 'US',
            airspace: airport.airspace || airport.airspace_class || airport.a || 'G',
            fuel: airport.fuel || airport.fuel_raw || airport.f || 'None',
            runways: runwaysRaw.map(normalizeRunway).filter((runway) => runway.rwy_id),
            approaches: approachesRaw.map(normalizeApproach).filter((approach) => approach.name),
            lat,
            lon,
            elevation: Number(airport.elevation ?? airport.e ?? 0),
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

  const locationIndex = useMemo(() => buildLocationIndex(airportData), [airportData]);

  return {
    airportData,
    databaseVersion,
    loading,
    error,
    locationIndex,
  };
}

import { useEffect, useMemo, useState } from 'react';
import { buildLocationIndex } from '../utils/filtering';

const ENDPOINT = '/.netlify/functions/airport-data';

function isFiniteCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
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
          const code = String(airport.airport_code || airport.code || '').trim().toUpperCase();
          if (!code) return;

          const lat = Number(airport.lat);
          const lon = Number(airport.lon);

          if (!isFiniteCoord(lat, lon)) {
            invalidCoordCount += 1;
            return;
          }

          normalized[code] = {
            ...airport,
            airport_code: code,
            state: airport.state || 'unknown',
            country: airport.country || 'US',
            airspace: airport.airspace || airport.airspace_class || 'G',
            fuel: airport.fuel || airport.fuel_raw || 'None',
            runways: Array.isArray(airport.runways) ? airport.runways : [],
            approaches: Array.isArray(airport.approaches) ? airport.approaches : [],
            lat,
            lon,
            elevation: Number(airport.elevation || 0),
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

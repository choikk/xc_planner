import { haversine } from './geo';

export function buildLocationIndex(airportData) {
  const countries = new Set();
  const statesByCountry = {};
  const airportsByState = {};

  Object.entries(airportData).forEach(([code, airport]) => {
    const country = String(airport.country || 'US').trim();
    const state = String(airport.state || 'unknown').trim();
    countries.add(country);
    if (!statesByCountry[country]) statesByCountry[country] = new Set();
    statesByCountry[country].add(state);
    const key = `${country}-${state}`;
    if (!airportsByState[key]) airportsByState[key] = [];
    airportsByState[key].push({ code, name: airport.airport_name || code });
  });

  return {
    countries: [...countries].sort(),
    statesByCountry,
    airportsByState,
  };
}

function deriveRunwaySummaryFromRunways(runways = []) {
  return runways.reduce((summary, runway) => {
    const surface = String(runway.surface || '').toUpperCase().split('-')[0];
    const length = parseInt(runway.length, 10) || 0;
    const key = ['ASPH', 'CONC', 'TURF'].includes(surface) ? surface : 'OTHER';
    summary[key] = Math.max(summary[key], length);
    return summary;
  }, { ASPH: 0, CONC: 0, TURF: 0, OTHER: 0 });
}

function getRunwaySummary(airport) {
  if (airport.runwaySummary) {
    return {
      ASPH: Number(airport.runwaySummary.ASPH || 0),
      CONC: Number(airport.runwaySummary.CONC || 0),
      TURF: Number(airport.runwaySummary.TURF || 0),
      OTHER: Number(airport.runwaySummary.OTHER || 0),
    };
  }

  return deriveRunwaySummaryFromRunways(Array.isArray(airport.runways) ? airport.runways : []);
}

function deriveApproachSummaryFromApproaches(approaches = []) {
  return approaches.reduce((summary, approach) => {
    const name = String(approach.name || '').toUpperCase();
    if (name.includes('RNAV')) summary.hasRnav = true;
    if (name.includes('ILS') || name.includes('LOC')) summary.hasIlsLoc = true;
    if (name.includes('VOR') || name.includes('NDB')) summary.hasVorNdb = true;
    summary.count += 1;
    return summary;
  }, { count: 0, hasRnav: false, hasIlsLoc: false, hasVorNdb: false });
}

function getApproachSummary(airport) {
  if (airport.approachSummary) {
    return {
      count: Number(airport.approachSummary.count || 0),
      hasRnav: Boolean(airport.approachSummary.hasRnav),
      hasIlsLoc: Boolean(airport.approachSummary.hasIlsLoc),
      hasVorNdb: Boolean(airport.approachSummary.hasVorNdb),
    };
  }

  return deriveApproachSummaryFromApproaches(Array.isArray(airport.approaches) ? airport.approaches : []);
}

function airportMatchesFilters(airport, filters) {
  if (!filters.airspaces.includes(airport.airspace)) return false;
  if (airport.elevation > filters.maxAirportElev) return false;
  if (filters.mustHaveFuel && airport.fuel === 'None') return false;

  const runwaySummary = getRunwaySummary(airport);
  const hasEligibleRunway = filters.surfaces.some((surface) => {
    const maxLength = Number(runwaySummary[surface] || 0);
    return maxLength >= filters.minRunwayLength;
  });
  if (!hasEligibleRunway) return false;

  if (filters.approaches.length > 0) {
    const approachSummary = getApproachSummary(airport);
    const matchesAnyApproach = filters.approaches.some((approach) => {
      if (approach === 'RNAV') return approachSummary.hasRnav;
      if (approach === 'ILS/LOC') return approachSummary.hasIlsLoc;
      if (approach === 'VOR/NDB') return approachSummary.hasVorNdb;
      return false;
    });
    const matchesNone = approachSummary.count === 0 && filters.approaches.includes('None');
    if (!matchesAnyApproach && !matchesNone) return false;
  }

  return true;
}

export function findFirstLegDestinations(airportData, homeCode, filters) {
  const home = airportData[homeCode];
  if (!home) return [];

  const results = [];
  Object.entries(airportData).forEach(([code, airport]) => {
    if (code === homeCode) return;
    if (!airportMatchesFilters(airport, filters)) return;
    const distance = haversine(home.lat, home.lon, airport.lat, airport.lon);
    if (distance < filters.firstLegMin || distance > filters.firstLegMax) return;
    if (filters.tripType === 'two' && distance * 2 > filters.totalLegMax) return;

    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      distance,
      lat: airport.lat,
      lon: airport.lon,
      elevation: airport.elevation,
      fuel: airport.fuel,
    });
  });
  return sortResults(results, filters.sortBy, 'first');
}

export function findFilteredInRangeFirstLegDestinations(airportData, homeCode, filters) {
  const home = airportData[homeCode];
  if (!home) return [];

  const results = [];
  Object.entries(airportData).forEach(([code, airport]) => {
    if (code === homeCode) return;

    const distance = haversine(home.lat, home.lon, airport.lat, airport.lon);
    if (distance < filters.firstLegMin || distance > filters.firstLegMax) return;
    if (filters.tripType === 'two' && distance * 2 > filters.totalLegMax) return;
    if (airportMatchesFilters(airport, filters)) return;

    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      airspace: airport.airspace,
      distance,
      lat: airport.lat,
      lon: airport.lon,
      elevation: airport.elevation,
      fuel: airport.fuel,
    });
  });

  return sortResults(results, filters.sortBy, 'first');
}

export function findNearbyOuterFirstLegDestinations(airportData, homeCode, filters, outerBufferNm = 100) {
  const home = airportData[homeCode];
  if (!home) return [];

  const results = [];
  const outerMax = filters.firstLegMax + outerBufferNm;

  Object.entries(airportData).forEach(([code, airport]) => {
    if (code === homeCode) return;
    if (!airportMatchesFilters(airport, filters)) return;

    const distance = haversine(home.lat, home.lon, airport.lat, airport.lon);
    if (distance <= filters.firstLegMax || distance > outerMax) return;

    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      distance,
      lat: airport.lat,
      lon: airport.lon,
      elevation: airport.elevation,
      fuel: airport.fuel,
    });
  });

  return sortResults(results, filters.sortBy, 'first');
}

export function findSecondLegDestinations(airportData, homeCode, firstLegCode, filters) {
  const home = airportData[homeCode];
  const first = airportData[firstLegCode];
  if (!home || !first) return [];

  const baseToFirst = haversine(home.lat, home.lon, first.lat, first.lon);
  const results = [];

  Object.entries(airportData).forEach(([code, airport]) => {
    if (code === homeCode || code === firstLegCode) return;
    if (!airportMatchesFilters(airport, filters)) return;

    const leg2 = haversine(first.lat, first.lon, airport.lat, airport.lon);
    const leg3 = haversine(airport.lat, airport.lon, home.lat, home.lon);
    const totalDistance = baseToFirst + leg2 + leg3;

    if (totalDistance < filters.totalLegMin || totalDistance > filters.totalLegMax) return;

    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      airspace: airport.airspace,
      elevation: airport.elevation,
      fuel: airport.fuel,
      totalDistance,
      leg2Distance: leg2,
      leg3Distance: leg3,
      fromCode: firstLegCode,
      homeCode,
    });
  });

  return sortResults(results, filters.sortBy, 'second');
}

export function sortResults(results, sortBy, type) {
  const copy = [...results];
  copy.sort((a, b) => {
    if (sortBy === 'alphabetical') return a.code.localeCompare(b.code);
    if (sortBy === 'total_distance') {
      const aVal = type === 'first' ? a.distance * 2 : a.totalDistance;
      const bVal = type === 'first' ? b.distance * 2 : b.totalDistance;
      return aVal - bVal;
    }
    const aVal = type === 'first' ? a.distance : a.leg2Distance;
    const bVal = type === 'first' ? b.distance : b.leg2Distance;
    return aVal - bVal;
  });
  return copy;
}

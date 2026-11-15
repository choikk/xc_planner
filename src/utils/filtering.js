import { formatCourse, haversine, legCourse } from './geo';

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

export function airportMatchesFilters(airport, filters) {
  if (filters.excludeNonPublic && airport.access && airport.access !== 'pub') return false;
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

// ---------- One-way (A -> B) planning ----------
// The destination B is chosen first. Then the route is built one leg at a time: each leg has its own min/max distance
// (legs[i] ends at stop i; the last entry is the leg being defined, which ends at the next stop or at B).

function distanceBetween(airportData, codeA, codeB) {
  const a = airportData[codeA];
  const b = airportData[codeB];
  if (!a || !b) return null;
  return haversine(a.lat, a.lon, b.lat, b.lon);
}

// Next-stop candidates: every airport that passes the filters and lies inside the leg's min/max from the current point.
// `closer` marks the ones that bring the route nearer to B (the others stay selectable but are drawn faded).
export function findOneWayStopCandidates(airportData, { originCode, destCode, leg, filters, excludeCodes = [] }) {
  const origin = airportData[originCode];
  const dest = airportData[destCode];
  if (!origin || !dest || !leg) return [];
  const remaining = haversine(origin.lat, origin.lon, dest.lat, dest.lon);
  const excluded = new Set([originCode, destCode, ...excludeCodes]);

  const results = [];
  Object.entries(airportData).forEach(([code, airport]) => {
    if (excluded.has(code)) return;
    if (!airportMatchesFilters(airport, filters)) return;
    const distance = haversine(origin.lat, origin.lon, airport.lat, airport.lon);
    if (distance < leg.min || distance > leg.max) return;
    const toDest = haversine(airport.lat, airport.lon, dest.lat, dest.lon);

    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      airspace: airport.airspace,
      elevation: airport.elevation,
      fuel: airport.fuel,
      lat: airport.lat,
      lon: airport.lon,
      distance,
      toDest,
      closer: toDest < remaining,
    });
  });

  results.sort((a, b) => {
    if (filters.sortBy === 'alphabetical') return a.code.localeCompare(b.code);
    if (filters.sortBy === 'total_distance') return a.toDest - b.toDest;
    return a.distance - b.distance;
  });
  return results;
}

// B can be the end of the current leg when its distance from the current point is inside the leg's min/max.
export function oneWayFinishInfo(airportData, originCode, destCode, leg) {
  const distance = distanceBetween(airportData, originCode, destCode);
  if (distance === null || !leg) return { distance: distance ?? 0, canFinish: false };
  return { distance, canFinish: distance >= leg.min && distance <= leg.max };
}

// Longest valid part of the chosen route: every stop must pass the filters and lie inside its leg's min/max,
// and a finished route needs B inside the final leg's min/max.
export function validateOneWayRoute(airportData, homeCode, destCode, legs, stops, finished, filters) {
  const valid = [];
  let previous = homeCode;
  for (let index = 0; index < stops.length; index += 1) {
    const code = stops[index];
    const airport = airportData[code];
    const leg = legs[index];
    if (!airport || !leg || code === homeCode || code === destCode || valid.includes(code)) break;
    if (!airportMatchesFilters(airport, filters)) break;
    const distance = distanceBetween(airportData, previous, code);
    if (distance === null || distance < leg.min || distance > leg.max) break;
    valid.push(code);
    previous = code;
  }

  const allStopsValid = valid.length === stops.length;
  const finalLeg = legs[valid.length];
  const stillFinished = Boolean(
    finished && allStopsValid && finalLeg && oneWayFinishInfo(airportData, previous, destCode, finalLeg).canFinish
  );
  return { stops: valid, finished: stillFinished };
}

// Per-leg distances of the route chosen so far (the last leg, to B, appears once the route is finished).
export function buildOneWaySegments(airportData, homeCode, destCode, legs, stops, finished) {
  const points = [homeCode, ...stops];
  const targets = finished ? [...stops, destCode] : stops;
  const segments = [];

  targets.forEach((to, index) => {
    const from = points[index];
    const distance = distanceBetween(airportData, from, to);
    const leg = legs[index];
    if (distance === null || !leg) return;
    const a = airportData[from];
    const b = airportData[to];
    segments.push({
      from,
      to,
      distance,
      mc: formatCourse(legCourse(a.lat, a.lon, b.lat, b.lon).magnetic),
      min: leg.min,
      max: leg.max,
      ok: distance >= leg.min && distance <= leg.max,
    });
  });

  return {
    segments,
    complete: Boolean(finished),
    direct: distanceBetween(airportData, homeCode, destCode) ?? 0,   // straight A -> B distance
    total: segments.reduce((sum, segment) => sum + segment.distance, 0),
    allOk: Boolean(finished) && segments.every((segment) => segment.ok),
  };
}

// Why nothing can be chosen next (used when there are no candidates and B is not reachable yet).
export function describeOneWayStuck(airportData, originCode, destCode, leg) {
  const distance = distanceBetween(airportData, originCode, destCode);
  if (distance === null || !leg) return '';
  if (distance < leg.min) {
    return `${destCode} is only ${distance.toFixed(0)} NM from ${originCode}, less than this leg's minimum of ${leg.min} NM. Lower the minimum to finish at ${destCode}.`;
  }
  return `${destCode} is ${distance.toFixed(0)} NM from ${originCode}, but no airport ${leg.min}–${leg.max} NM away passes the current filters. Raise the maximum, lower the minimum, or relax the filters.`;
}

// Airports that can be chosen as the destination when picking it on the map: filters + a min/max distance from the home base.
export function findDestinationCandidates(airportData, homeCode, range, filters) {
  const home = airportData[homeCode];
  if (!home) return [];

  const results = [];
  Object.entries(airportData).forEach(([code, airport]) => {
    if (code === homeCode) return;
    if (!airportMatchesFilters(airport, filters)) return;
    const distance = haversine(home.lat, home.lon, airport.lat, airport.lon);
    if (distance < range.min || distance > range.max) return;
    results.push({
      code,
      name: airport.airport_name,
      city: airport.city,
      state: airport.state,
      airspace: airport.airspace,
      elevation: airport.elevation,
      fuel: airport.fuel,
      lat: airport.lat,
      lon: airport.lon,
      distance,
    });
  });

  results.sort((a, b) => (filters.sortBy === 'alphabetical' ? a.code.localeCompare(b.code) : a.distance - b.distance));
  return results;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getAirspaceColor(classCode) {
  switch (classCode) {
    case 'B':
      return '#3399FF';
    case 'C':
      return '#FF3333';
    case 'D':
      return '#0000FF';
    case 'E':
      return '#FF00FF';
    case 'G':
      return '#777777';
    default:
      return '#666666';
  }
}

export function formatSurface(code = '') {
  switch (code) {
    case 'ASPH':
      return 'Asphalt';
    case 'CONC':
      return 'Concrete';
    case 'TURF':
      return 'Grass';
    case 'GRVL':
      return 'Gravel';
    case 'DIRT':
      return 'Dirt';
    case 'WATER':
      return 'Water';
    case 'OTHER':
      return 'Other';
    default:
      return code;
  }
}

export function computeBearing(startLatDeg, startLonDeg, endLatDeg, endLonDeg) {
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const toDegrees = (rad) => (rad * 180) / Math.PI;

  const lat1 = toRadians(startLatDeg);
  const lon1 = toRadians(startLonDeg);
  const lat2 = toRadians(endLatDeg);
  const lon2 = toRadians(endLonDeg);
  const deltaLon = lon2 - lon1;

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return (toDegrees(Math.atan2(x, y)) + 360) % 360;
}

export function destinationPoint(startLatDeg, startLonDeg, bearingDeg, distanceNm) {
  const earthRadiusNm = 3440.065;
  const toRadians = (deg) => (deg * Math.PI) / 180;
  const toDegrees = (rad) => (rad * 180) / Math.PI;

  const angularDistance = distanceNm / earthRadiusNm;
  const bearingRad = toRadians(bearingDeg);
  const startLatRad = toRadians(startLatDeg);
  const startLonRad = toRadians(startLonDeg);

  const destLatRad = Math.asin(
    Math.sin(startLatRad) * Math.cos(angularDistance) +
      Math.cos(startLatRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );

  const destLonRad =
    startLonRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(startLatRad),
      Math.cos(angularDistance) - Math.sin(startLatRad) * Math.sin(destLatRad)
    );

  return [
    toDegrees(destLatRad),
    ((toDegrees(destLonRad) + 540) % 360) - 180,
  ];
}

export function computeEllipsePoints(focusA, focusB, semiMajorNm, numPoints = 180) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const [latA, lonA] = focusA;
  const [latB, lonB] = focusB;
  const centerLat = (latA + latB) / 2;
  const centerLon = (lonA + lonB) / 2;
  const distanceBetweenFoci = haversine(latA, lonA, latB, lonB);

  if (semiMajorNm < distanceBetweenFoci / 2) return [];

  const semiMinorNm = Math.sqrt(semiMajorNm ** 2 - (distanceBetweenFoci / 2) ** 2);
  const bearingDeg = computeBearing(latA, lonA, latB, lonB);
  const bearingRad = toRad(bearingDeg);
  const points = [];

  for (let i = 0; i <= numPoints; i += 1) {
    const theta = (2 * Math.PI * i) / numPoints;
    const dx = semiMajorNm * Math.cos(theta);
    const dy = semiMinorNm * Math.sin(theta);
    const xRot = dx * Math.cos(bearingRad) - dy * Math.sin(bearingRad);
    const yRot = dx * Math.sin(bearingRad) + dy * Math.cos(bearingRad);
    const pointDistance = Math.sqrt(xRot ** 2 + yRot ** 2);
    const pointBearing = (toDeg(Math.atan2(xRot, yRot)) + 360) % 360;
    points.push(destinationPoint(centerLat, centerLon, pointBearing, pointDistance));
  }

  return points;
}

const { Client } = require('pg');

function buildClient() {
  const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL/NETLIFY_DATABASE_URL/NEON_DATABASE_URL');
  }
  return new Client({ connectionString, ssl: { rejectUnauthorized: false } });
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickCode(row) {
  return String(
    row.airport_code ?? row.airport_id ?? row.icao_id ?? row.faa_id ?? row.code ?? ''
  ).trim().toUpperCase();
}

function normalizeAirport(row) {
  return {
    airport_code: pickCode(row),
    airport_name: row.airport_name ?? row.name ?? 'Unknown Airport',
    city: row.city ?? 'Unknown',
    state: row.state ?? row.region ?? 'unknown',
    country: row.country ?? row.country_code ?? 'US',
    elevation: Number(row.elevation ?? row.elevation_ft ?? 0),
    fuel: row.fuel ?? row.fuel_raw ?? 'None',
    airspace: row.airspace ?? row.airspace_class ?? 'G',
    lat: Number(row.lat ?? row.latitude ?? row.latitude_deg ?? row.lat_decimal ?? 0),
    lon: Number(row.lon ?? row.longitude ?? row.longitude_deg ?? row.long_decimal ?? 0),
    runways: parseJsonArray(row.runways),
    approaches: parseJsonArray(row.approaches),
  };
}

exports.handler = async (event) => {
  const client = buildClient();

  try {
    await client.connect();

    const metaOnly = event.queryStringParameters?.meta === '1';
    const versionResult = await client.query(`
      select current_date::text as database_version,
             count(*)::int as airport_count
      from airports_v2
    `);

    const databaseVersion = versionResult.rows[0]?.database_version || 'UNKNOWN';
    const airportCount = versionResult.rows[0]?.airport_count || 0;

    if (metaOnly) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ databaseVersion, airportCount }),
      };
    }

    const result = await client.query('select * from airports_v2 order by coalesce(country,\'US\'), coalesce(state,\'unknown\'), coalesce(airport_code, airport_id, icao_id, faa_id, code)');

    const airports = result.rows
      .map(normalizeAirport)
      .filter((row) => row.airport_code && Number.isFinite(row.lat) && Number.isFinite(row.lon));

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
      body: JSON.stringify({
        databaseVersion,
        airportCount,
        airports,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Failed to load airports_v2 data',
        details: error.message,
      }),
    };
  } finally {
    await client.end().catch(() => {});
  }
};

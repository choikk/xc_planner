import pg from 'pg';

const { Client } = pg;

function buildClient() {
  const connectionString =
    process.env.NEON_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Missing NEON_DATABASE_URL');
  }

  return new Client({ connectionString });
}

function safeObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function handler(event) {
  const client = buildClient();

  try {
    await client.connect();

    const versionResult = await client.query(`
      select effective_date as database_version
      from dataset_versions
      where dataset_name = 'airports_v2_source'
      order by effective_date desc
      limit 1
    `);

    const databaseVersion =
      versionResult.rows[0]?.database_version || 'UNKNOWN';

    const countResult = await client.query(`
      select count(*)::int as airport_count
      from airports_v2
    `);

    const airportCount = countResult.rows[0]?.airport_count || 0;

    console.log('[airport-data] versionResult.rows =', versionResult.rows);
    console.log('[airport-data] databaseVersion =', databaseVersion);
    console.log('[airport-data] airportCount =', airportCount);

    if (event.queryStringParameters?.meta === '1') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ databaseVersion, airportCount }),
      };
    }

    const result = await client.query(`
      select airport_code, raw_json
      from airports_v2
      where airport_code is not null
      order by airport_code
    `);

    const airports = result.rows
      .map((row) => {
        const raw = safeObject(row.raw_json);

        return {
          airport_code: String(row.airport_code || '').trim().toUpperCase(),
          airport_name: raw.airport_name || '',
          city: raw.city || '',
          state: raw.state || 'unknown',
          country: raw.country || 'US',
          lat: Number(raw.lat),
          lon: Number(raw.lon),
          elevation: Number(raw.elevation || 0),
          fuel: raw.fuel || raw.fuel_raw || 'None',
          airspace: raw.airspace || raw.airspace_class || 'G',
          remarks: raw.remarks || '',
          runways: Array.isArray(raw.runways) ? raw.runways : [],
          approaches: Array.isArray(raw.approaches) ? raw.approaches : [],
        };
      })
      .filter((airport) => airport.airport_code);

    console.log('[airport-data] result.rows.length =', result.rows.length);
    console.log('[airport-data] airports.length =', airports.length);
    console.log('[airport-data] first 3 airport codes =', airports.slice(0, 3).map((a) => a.airport_code));

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
    console.error('[airport-data] ERROR =', error);

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
}

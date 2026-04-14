import { Readable } from 'node:stream';
import { stream } from '@netlify/functions';
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

function compactRunway(runway) {
  return {
    i: runway.rwy_id || '',
    l: Number(runway.length || 0),
    w: Number(runway.width || 0),
    s: runway.surface || '',
    c: runway.condition || '',
  };
}

function compactApproach(approach) {
  return {
    n: approach.name || '',
    u: approach.pdf_url || '',
  };
}

function compactAirport(row) {
  const raw = safeObject(row.raw_json);
  const runways = Array.isArray(raw.runways) ? raw.runways.map(compactRunway).filter((runway) => runway.i) : [];
  const approaches = Array.isArray(raw.approaches)
    ? raw.approaches.map(compactApproach).filter((approach) => approach.n)
    : [];

  const airport = {
    c: String(row.airport_code || '').trim().toUpperCase(),
    n: raw.airport_name || '',
    ci: raw.city || '',
    s: raw.state || 'unknown',
    la: Number(raw.lat),
    lo: Number(raw.lon),
    e: Number(raw.elevation || 0),
    a: raw.airspace || raw.airspace_class || 'G',
  };

  if (raw.country && raw.country !== 'US') {
    airport.co = raw.country;
  }

  if (raw.fuel && raw.fuel !== 'None') {
    airport.f = raw.fuel;
  } else if (raw.fuel_raw && raw.fuel_raw !== 'None') {
    airport.f = raw.fuel_raw;
  }

  if (runways.length > 0) {
    airport.r = runways;
  }

  if (approaches.length > 0) {
    airport.p = approaches;
  }

  return airport;
}

export const handler = stream(async (event) => {
  let client;

  try {
    client = buildClient();
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

    const body = Readable.from(
      (async function* streamAirports() {
        yield `{"databaseVersion":${JSON.stringify(databaseVersion)},"airportCount":${JSON.stringify(airportCount)},"airports":[`;

        let first = true;
        for (const row of result.rows) {
          const airport = compactAirport(row);
          if (!airport.c) continue;

          if (!first) {
            yield ',';
          }

          yield JSON.stringify(airport);
          first = false;
        }

        yield ']}';
      })()
    );

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
      body,
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
    if (client) {
      await client.end().catch(() => {});
    }
  }
});

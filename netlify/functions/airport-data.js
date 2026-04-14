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

function parseCodesParam(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function isAllowedApproachHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'faa.gov' || normalized.endsWith('.faa.gov');
}

function normalizeDetailedAirport(row) {
  return {
    airport_code: String(row.airport_code || '').trim().toUpperCase(),
    airport_name: row.airport_name || '',
    city: row.city || '',
    state: row.state || 'unknown',
    country: row.country || 'US',
    lat: Number(row.lat),
    lon: Number(row.lon),
    elevation: Number(row.elevation || 0),
    fuel: row.fuel_raw || 'None',
    airspace: row.airspace_class || 'G',
    remarks: row.remarks || '',
    runways: Array.isArray(row.runways) ? row.runways : safeObject(row.runways),
    approaches: Array.isArray(row.approaches) ? row.approaches : safeObject(row.approaches),
  };
}

function compactBaseAirport(row) {
  return {
    c: String(row.airport_code || '').trim().toUpperCase(),
    n: row.airport_name || '',
    ci: row.city || '',
    s: row.state || 'unknown',
    co: row.country || 'US',
    la: Number(row.lat),
    lo: Number(row.lon),
    e: Number(row.elevation || 0),
    a: row.airspace_class || 'G',
    f: row.fuel_raw || 'None',
    rm: [
      Number(row.max_asph || 0),
      Number(row.max_conc || 0),
      Number(row.max_turf || 0),
      Number(row.max_other || 0),
    ],
    ac: Number(row.approach_count || 0),
    ab:
      (row.has_rnav ? 1 : 0) +
      (row.has_ilsloc ? 2 : 0) +
      (row.has_vorndb ? 4 : 0),
  };
}

export async function handler(event) {
  let client;

  try {
    const plateUrl = event.queryStringParameters?.plateUrl;
    if (plateUrl) {
      const targetUrl = new URL(plateUrl);
      if (targetUrl.protocol !== 'https:' || !isAllowedApproachHost(targetUrl.hostname)) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ error: 'Unsupported approach plate host' }),
        };
      }

      const plateResponse = await fetch(targetUrl.toString(), {
        headers: {
          accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
        },
      });

      if (!plateResponse.ok) {
        return {
          statusCode: plateResponse.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ error: `Failed to fetch approach plate: HTTP ${plateResponse.status}` }),
        };
      }

      const plateBuffer = await plateResponse.arrayBuffer();
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          'content-type': plateResponse.headers.get('content-type') || 'application/pdf',
          'cache-control': 'public, max-age=86400',
        },
        body: Buffer.from(plateBuffer).toString('base64'),
      };
    }

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

    const requestedCodes = parseCodesParam(event.queryStringParameters?.codes);
    if (requestedCodes.length > 0) {
      const detailsResult = await client.query(
        `
          select
            a.airport_code,
            a.airport_name,
            a.city,
            a.state,
            a.country,
            a.lat,
            a.lon,
            a.elevation,
            a.airspace_class,
            a.fuel_raw,
            a.remarks,
            coalesce((
              select json_agg(
                json_build_object(
                  'rwy_id', r.rwy_id,
                  'length', coalesce(r.length_ft, 0),
                  'width', coalesce(r.width_ft, 0),
                  'surface', coalesce(r.surface, ''),
                  'condition', coalesce(r.condition, '')
                )
                order by r.rwy_id
              )
              from airport_runways_v2 r
              where r.airport_code = a.airport_code
            ), '[]'::json) as runways,
            coalesce((
              select json_agg(
                json_build_object(
                  'name', ap.approach_name,
                  'pdf_url', coalesce(ap.pdf_url, '')
                )
                order by ap.approach_name
              )
              from airport_approaches_v2 ap
              where ap.airport_code = a.airport_code
            ), '[]'::json) as approaches
          from airports_v2 a
          where a.airport_code = any($1::text[])
          order by a.airport_code
        `,
        [requestedCodes]
      );

      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
        body: JSON.stringify({
          airports: detailsResult.rows.map(normalizeDetailedAirport),
        }),
      };
    }

    const result = await client.query(`
      with runway_summary as (
        select
          airport_code,
          max(case when upper(coalesce(surface, '')) = 'ASPH' then coalesce(length_ft, 0) else 0 end) as max_asph,
          max(case when upper(coalesce(surface, '')) = 'CONC' then coalesce(length_ft, 0) else 0 end) as max_conc,
          max(case when upper(coalesce(surface, '')) = 'TURF' then coalesce(length_ft, 0) else 0 end) as max_turf,
          max(case when upper(coalesce(surface, '')) not in ('ASPH', 'CONC', 'TURF') then coalesce(length_ft, 0) else 0 end) as max_other
        from airport_runways_v2
        group by airport_code
      ),
      approach_summary as (
        select
          airport_code,
          count(*)::int as approach_count,
          bool_or(upper(approach_name) like '%RNAV%') as has_rnav,
          bool_or(upper(approach_name) like '%ILS%' or upper(approach_name) like '%LOC%') as has_ilsloc,
          bool_or(upper(approach_name) like '%VOR%' or upper(approach_name) like '%NDB%') as has_vorndb
        from airport_approaches_v2
        group by airport_code
      )
      select
        a.airport_code,
        a.airport_name,
        a.city,
        a.state,
        a.country,
        a.lat,
        a.lon,
        a.elevation,
        coalesce(a.airspace_class, 'G') as airspace_class,
        coalesce(nullif(a.fuel_raw, ''), 'None') as fuel_raw,
        coalesce(rs.max_asph, 0) as max_asph,
        coalesce(rs.max_conc, 0) as max_conc,
        coalesce(rs.max_turf, 0) as max_turf,
        coalesce(rs.max_other, 0) as max_other,
        coalesce(ap.approach_count, 0) as approach_count,
        coalesce(ap.has_rnav, false) as has_rnav,
        coalesce(ap.has_ilsloc, false) as has_ilsloc,
        coalesce(ap.has_vorndb, false) as has_vorndb
      from airports_v2 a
      left join runway_summary rs on rs.airport_code = a.airport_code
      left join approach_summary ap on ap.airport_code = a.airport_code
      where a.airport_code is not null
      order by a.airport_code
    `);

    const airports = result.rows
      .map(compactBaseAirport)
      .filter((airport) => airport.c);

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
    if (client) {
      await client.end().catch(() => {});
    }
  }
}

function isAllowedApproachHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'faa.gov' || normalized.endsWith('.faa.gov');
}

export async function handler(event) {
  try {
    const rawUrl = event.queryStringParameters?.url;
    if (!rawUrl) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Missing url parameter' }),
      };
    }

    const targetUrl = new URL(rawUrl);
    if (targetUrl.protocol !== 'https:' || !isAllowedApproachHost(targetUrl.hostname)) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Unsupported approach plate host' }),
      };
    }

    const response = await fetch(targetUrl.toString(), {
      headers: {
        accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: `Failed to fetch approach plate: HTTP ${response.status}` }),
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/pdf',
        'cache-control': 'public, max-age=86400',
      },
      body: Buffer.from(arrayBuffer).toString('base64'),
    };
  } catch (error) {
    console.error('[approach-plate] ERROR =', error);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Failed to proxy approach plate',
        details: error.message,
      }),
    };
  }
}

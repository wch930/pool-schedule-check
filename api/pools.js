import { getPoolsPayload } from '../lib/toronto-api.js';

/**
 * Vercel Serverless Function: GET /api/pools
 */
export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  try {
    const url = new URL(req.url || '/api/pools', 'http://localhost');
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const data = await getPoolsPayload({ forceRefresh });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      forceRefresh
        ? 'no-store'
        : 'public, s-maxage=120, stale-while-revalidate=300'
    );
    res.end(JSON.stringify(data));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'Failed to fetch City of Toronto pool schedule',
        message: err?.message || 'Unknown error',
      })
    );
  }
}

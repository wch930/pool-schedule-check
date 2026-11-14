import { getPoolsPayload } from './lib/toronto-api.js';

/**
 * Cloudflare Worker entrypoint with Static Assets ([assets] directory = "./public").
 * Static files in ./public are served directly at the edge; /api/pools runs here.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/pools') {
      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      try {
        const forceRefresh = url.searchParams.get('refresh') === '1';
        const data = await getPoolsPayload({ forceRefresh });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': forceRefresh
              ? 'no-store'
              : 'public, s-maxage=120, stale-while-revalidate=300',
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: 'Failed to fetch City of Toronto pool schedule',
            message: err?.message || 'Unknown error',
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }
    }

    if (env?.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

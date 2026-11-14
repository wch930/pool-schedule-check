import { getPoolsPayload } from '../../lib/toronto-api.js';

/**
 * Cloudflare Pages Function: GET /api/pools
 */
export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
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
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      }
    );
  }
}

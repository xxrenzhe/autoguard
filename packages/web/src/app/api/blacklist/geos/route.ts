import { proxyBlacklistGET, proxyBlacklistPOST } from '../_proxy';

// GET /api/blacklist/geos - List Geo blacklist entries
export async function GET(request: Request) {
  return proxyBlacklistGET(request, 'geo');
}

// POST /api/blacklist/geos - Add Geo blacklist entry
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  return proxyBlacklistPOST(request, 'geo', {
    type: 'geo',
    country_code: body.country_code,
    region_code: body.region_code,
    block_type: body.block_type,
    reason: body.reason,
    source: body.source,
    scope: body.scope,
  });
}


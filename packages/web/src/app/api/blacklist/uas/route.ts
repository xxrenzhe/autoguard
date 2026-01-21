import { proxyBlacklistGET, proxyBlacklistPOST } from '../_proxy';

// GET /api/blacklist/uas - List UA blacklist entries
export async function GET(request: Request) {
  return proxyBlacklistGET(request, 'ua');
}

// POST /api/blacklist/uas - Add UA blacklist entry
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  return proxyBlacklistPOST(request, 'ua', {
    type: 'ua',
    value: body.pattern || body.value,
    pattern_type: body.pattern_type,
    description: body.description,
    source: body.source,
    scope: body.scope,
  });
}


import { proxyBlacklistGET, proxyBlacklistPOST } from '../_proxy';

// GET /api/blacklist/ip-ranges - List CIDR blacklist entries
export async function GET(request: Request) {
  return proxyBlacklistGET(request, 'ip_range');
}

// POST /api/blacklist/ip-ranges - Add CIDR blacklist entry
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const cidrValue = (body.cidr || body.value) as string | undefined;

  return proxyBlacklistPOST(request, 'ip_range', {
    type: 'ip_range',
    value: cidrValue,
    reason: body.reason,
    source: body.source,
    expires_at: body.expires_at,
    scope: body.scope,
  });
}


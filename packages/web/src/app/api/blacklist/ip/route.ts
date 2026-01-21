import { proxyBlacklistGET, proxyBlacklistPOST } from '../_proxy';

// GET /api/blacklist/ip - List IP blacklist entries
export async function GET(request: Request) {
  return proxyBlacklistGET(request, 'ip');
}

// POST /api/blacklist/ip - Add IP blacklist entry
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  // Accept both SystemDesign2-style { ip: '1.2.3.4' } and internal { value: '1.2.3.4' }
  const ipValue = (body.ip || body.value) as string | undefined;

  return proxyBlacklistPOST(request, 'ip', {
    type: 'ip',
    value: ipValue,
    reason: body.reason,
    source: body.source,
    expires_at: body.expires_at,
    scope: body.scope,
  });
}


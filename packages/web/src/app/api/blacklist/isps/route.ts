import { proxyBlacklistGET, proxyBlacklistPOST } from '../_proxy';

// GET /api/blacklist/isps - List ISP/ASN blacklist entries
export async function GET(request: Request) {
  return proxyBlacklistGET(request, 'isp');
}

// POST /api/blacklist/isps - Add ISP/ASN blacklist entry
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  return proxyBlacklistPOST(request, 'isp', {
    type: 'isp',
    asn: body.asn || body.value,
    isp_name: body.isp_name,
    reason: body.reason,
    source: body.source,
    scope: body.scope,
  });
}


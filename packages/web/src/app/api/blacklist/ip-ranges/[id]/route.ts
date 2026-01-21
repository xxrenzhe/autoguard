import { proxyBlacklistDELETE } from '../../_proxy';

type Params = { params: Promise<{ id: string }> };

// DELETE /api/blacklist/ip-ranges/[id] - Remove CIDR entry
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyBlacklistDELETE(request, 'ip_range', id);
}


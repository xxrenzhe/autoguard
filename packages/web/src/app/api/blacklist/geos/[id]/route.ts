import { proxyBlacklistDELETE } from '../../_proxy';

type Params = { params: Promise<{ id: string }> };

// DELETE /api/blacklist/geos/[id] - Remove Geo entry
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyBlacklistDELETE(request, 'geo', id);
}


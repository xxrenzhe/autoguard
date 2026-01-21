import { proxyBlacklistDELETE } from '../../_proxy';

type Params = { params: Promise<{ id: string }> };

// DELETE /api/blacklist/uas/[id] - Remove UA entry
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyBlacklistDELETE(request, 'ua', id);
}


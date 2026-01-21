import { proxyBlacklistDELETE } from '../../_proxy';

type Params = { params: Promise<{ id: string }> };

// DELETE /api/blacklist/ip/[id] - Remove IP blacklist entry
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyBlacklistDELETE(request, 'ip', id);
}


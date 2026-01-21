import { GET as baseGET, POST as basePOST, DELETE as baseDELETE } from './route';

export async function proxyBlacklistGET(request: Request, type: string) {
  const url = new URL(request.url);
  url.searchParams.set('type', type);

  const proxied = new Request(url.toString(), {
    method: 'GET',
    headers: new Headers(request.headers),
  });

  return baseGET(proxied);
}

export async function proxyBlacklistPOST(request: Request, type: string, body: unknown) {
  const url = new URL(request.url);
  url.searchParams.set('type', type);

  const headers = new Headers(request.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const proxied = new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return basePOST(proxied);
}

export async function proxyBlacklistDELETE(request: Request, type: string, id: string) {
  const url = new URL(request.url);
  url.searchParams.set('type', type);
  url.searchParams.set('id', id);

  const proxied = new Request(url.toString(), {
    method: 'DELETE',
    headers: new Headers(request.headers),
  });

  return baseDELETE(proxied);
}


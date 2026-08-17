import type { IncomingMessage, ServerResponse } from 'node:http';

const FORBIDDEN_REQUEST_HEADERS = new Set(['cookie', 'cookie2', 'host', 'origin']);

export function incomingRequestUrl(req: IncomingMessage, url: string): string {
  const host = req.headers.host ?? 'localhost:5173';
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const origin = req.headers.origin;
  const protocol =
    forwarded === 'https' || forwarded === 'http'
      ? forwarded
      : typeof origin === 'string' && origin.startsWith('https://')
        ? 'https'
        : process.env.PORTLESS_URL?.startsWith('https://')
          ? 'https'
          : 'http';
  return `${protocol}://${host}${url}`;
}

export function nodeIncomingToWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const joined = key.toLowerCase() === 'cookie' ? value.join('; ') : value.join(', ');
      headers.set(key, joined);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Node's `Request` constructor strips forbidden headers (`cookie`, `origin`, `host`).
 * Re-attach the unfiltered Headers so session cookies survive Vite/`hyperspan dev`.
 */
export function nodeToWebRequest(req: IncomingMessage, url: string, body?: Buffer): Request {
  const headers = nodeIncomingToWebHeaders(req);
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
  };
  if (body) {
    init.body = new Uint8Array(body);
    init.duplex = 'half';
  }
  const request = new Request(url, init);

  if ([...FORBIDDEN_REQUEST_HEADERS].some((name) => headers.has(name) && !request.headers.has(name))) {
    Object.defineProperty(request, 'headers', {
      value: headers,
      writable: false,
      configurable: true,
    });
  }

  return request;
}

export function applyWebResponseToNode(response: Response, res: ServerResponse): void {
  res.statusCode = response.status;

  const setCookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });

  if (setCookies.length > 0) {
    res.setHeader('Set-Cookie', setCookies);
  }
}

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFetchHandler, type FetchHandlerOptions } from '@hyperspan/framework';
import type { Hyperspan as HS } from '@hyperspan/framework';

export type NodeAdapterOptions = FetchHandlerOptions & {
  port?: number;
  hostname?: string;
  publicDir?: string;
  root?: string;
};

/**
 * Start a Node.js HTTP server for a Hyperspan app.
 */
export function startNodeServer(server: HS.Server, options: NodeAdapterOptions = {}) {
  const root = options.root ?? process.cwd();
  const publicDir = options.publicDir ?? server._config.publicDir ?? './public';

  const fetch = createFetchHandler(server, {
    ...options,
    onNotMatched: async (request) => {
      const staticResponse = await serveStaticFile(request, root, publicDir);
      if (staticResponse) return staticResponse;
      return options.onNotMatched?.(request);
    },
  });

  const httpServer = createHttpServer(async (req, res) => {
    try {
      await handleNodeRequest(req, res, fetch);
    } catch (err) {
      console.error('[Hyperspan] Request error:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  const port = (options.port ?? Number(process.env.PORT)) || 3000;
  const hostname = options.hostname ?? '0.0.0.0';

  httpServer.listen(port, hostname, () => {
    console.log(`[Hyperspan] Node server listening on http://localhost:${port}`);
  });

  return { httpServer, fetch, port };
}

export async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  fetch: (request: Request) => Promise<Response>
) {
  const host = req.headers.host ?? 'localhost';
  const url = `http://${host}${req.url ?? '/'}`;

  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    if (chunks.length > 0) body = Buffer.concat(chunks);
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }

  const request = new Request(url, { method: req.method, headers, body });
  const response = await fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    res.setHeader(key, value);
  });

  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

async function serveStaticFile(
  request: Request,
  root: string,
  publicDir: string
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname.includes('..')) return undefined;

  const filePath = join(root, publicDir, url.pathname);
  try {
    const data = await readFile(filePath);
    const ext = url.pathname.split('.').pop() ?? '';
    const types: Record<string, string> = {
      css: 'text/css',
      js: 'application/javascript',
      mjs: 'application/javascript',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      woff2: 'font/woff2',
      woff: 'font/woff',
      json: 'application/json',
    };
    return new Response(data, {
      headers: { 'Content-Type': types[ext] ?? 'application/octet-stream' },
    });
  } catch {
    return undefined;
  }
}

export { createFetchHandler };

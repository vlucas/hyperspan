import { test, expect, describe } from 'bun:test';
import { createRoute, createServer, createContext } from './server';
import { createAction } from './actions';
import { html, placeholder } from '@hyperspan/html';
import type { Hyperspan as HS } from './types';

test('route fetch() returns a Response', async () => {
  const route = createRoute().get((context: HS.Context) => {
    return context.res.html('<h1>Hello World</h1>');
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>Hello World</h1>');
});

test('route handler returning undefined or null yields 204 No Content', async () => {
  const withHeader = createRoute().get((context: HS.Context) => {
    context.res.headers.set('X-Empty', '1');
  });

  const req = new Request('http://localhost:3000/');
  let response = await withHeader.fetch(req);
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(204);
  expect(response.headers.get('X-Empty')).toBe('1');
  expect(await response.text()).toBe('');

  const explicitNull = createRoute().get(() => null);
  response = await explicitNull.fetch(req);
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');

  const asyncVoid = createRoute().get(async () => undefined);
  response = await asyncVoid.fetch(req);
  expect(response.status).toBe(204);
});

test('server with two routes can return Response from one', async () => {
  const server = await createServer({
    appDir: './app',
    publicDir: './public',
    plugins: [],
  });

  // Add two routes to the server
  server.get('/users', (context: HS.Context) => {
    return context.res.html('<h1>Users Page</h1>');
  });

  server.get('/posts', (context: HS.Context) => {
    return context.res.html('<h1>Posts Page</h1>');
  });

  // Test that we can get a Response from one of the routes
  const request = new Request('http://localhost:3000/users');
  const testRoute = server._routes.find((route: HS.Route) => route._path() === '/users');
  const response = await testRoute!.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Users Page');
});

test('server returns a route with a POST request', async () => {
  const server = await createServer({
    appDir: './app',
    publicDir: './public',
    plugins: [],
  });

  // Add two routes to the server
  server.get('/users', (context: HS.Context) => {
    return context.res.html('<h1>GET /users</h1>');
  });

  server.post('/users', (context: HS.Context) => {
    return context.res.html('<h1>POST /users</h1>');
  });

  const route = server._routes.find(
    (route: HS.Route) => route._path() === '/users' && route._methods().includes('POST')
  ) as HS.Route;
  const request = new Request('http://localhost:3000/users', { method: 'POST' });
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>POST /users</h1>');
});

test('server returns a route with a ALL request', async () => {
  const server = await createServer({
    appDir: './app',
    publicDir: './public',
    plugins: [],
  });

  server.all('/users', (context: HS.Context) => {
    return context.res.html('<h1>ALL /users</h1>');
  });

  const route = server._routes.find(
    (route: HS.Route) => route._path() === '/users' && route._methods().includes('*')
  ) as HS.Route;

  // GET request
  let request = new Request('http://localhost:3000/users', { method: 'GET' });
  let response = await route.fetch(request);
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>ALL /users</h1>');

  // POST request
  request = new Request('http://localhost:3000/users', { method: 'POST' });
  response = await route.fetch(request);
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>ALL /users</h1>');
});

test('returns 405 when route path matches but HTTP method does not', async () => {
  const server = await createServer({
    appDir: './app',
    publicDir: './public',
    plugins: [],
  });

  // Route registered for GET only
  server.get('/users', (context: HS.Context) => {
    return context.res.html('<h1>Users Page</h1>');
  });

  // Attempt to POST to /users, which should return 405
  const route = server._routes.find((route: HS.Route) => route._path() === '/users')!;
  const request = new Request('http://localhost:3000/users', { method: 'POST' });
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(405);
  const text = await response.text();
  expect(text).toContain('Method not allowed');
});

test('createContext() can get and set cookies', () => {
  // Create a request with cookies in the Cookie header
  const request = new Request('http://localhost:3000/', {
    headers: {
      Cookie: 'sessionId=abc123; theme=dark; userId=42',
    },
  });

  // Create context from the request
  const context = createContext(request);

  // Test reading cookies from request
  expect(context.req.cookies.get('sessionId')).toBe('abc123');
  expect(context.req.cookies.get('theme')).toBe('dark');
  expect(context.req.cookies.get('userId')).toBe('42');
  expect(context.req.cookies.get('nonExistent')).toBeUndefined();

  // Test setting a simple cookie in response
  context.res.cookies.set('newCookie', 'newValue');
  let setCookieHeader = context.res.headers.get('Set-Cookie');
  expect(setCookieHeader).toBeTruthy();
  expect(setCookieHeader).toContain('newCookie=newValue');

  // Test setting a cookie with options (this should NOT overwrite the previous Set-Cookie header)
  context.res.cookies.set('secureCookie', 'secureValue', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 3600,
  });

  // Verify Set-Cookie header contains the last cookie set
  setCookieHeader = context.res.headers.get('Set-Cookie');
  expect(setCookieHeader).toBeTruthy();
  expect(setCookieHeader).toContain('secureCookie=secureValue');
  expect(setCookieHeader).toContain('newCookie=newValue');

  // Test deleting a cookie
  context.res.cookies.delete('sessionId');
  setCookieHeader = context.res.headers.get('Set-Cookie');
  expect(setCookieHeader).toBeTruthy();
  if (setCookieHeader) {
    expect(setCookieHeader).toContain('sessionId=');
    expect(setCookieHeader).toContain('Expires=');
    // Verify it's set to expire in the past (deleted)
    const expiresMatch = setCookieHeader.match(/Expires=([^;]+)/);
    expect(expiresMatch).toBeTruthy();
    if (expiresMatch) {
      const expiresDate = new Date(expiresMatch[1]);
      expect(expiresDate.getTime()).toBeLessThanOrEqual(new Date(0).getTime());
    }
  }
});

test('createContext() merge() function preserves custom headers when using response methods', async () => {
  // Create a request
  const request = new Request('http://localhost:3000/');

  // Create context from the request
  const context = createContext(request);

  // Set custom headers on the context response
  context.res.headers.set('X-Custom-Header', 'custom-value');
  context.res.headers.set('X-Another-Header', 'another-value');
  context.res.headers.set('Authorization', 'Bearer token123');

  // Use html() method which should merge headers
  const response = await context.res.html('<h1>Test</h1>');

  // Verify the response has both the custom headers and the Content-Type header
  expect(response.headers.get('X-Custom-Header')).toBe('custom-value');
  expect(response.headers.get('X-Another-Header')).toBe('another-value');
  expect(response.headers.get('Authorization')).toBe('Bearer token123');
  expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');

  // Verify response body is correct
  expect(response.status).toBe(200);
});

test('createContext() merge() function preserves custom headers with json() method', async () => {
  const request = new Request('http://localhost:3000/');
  const context = createContext(request);

  // Set custom headers
  context.res.headers.set('X-API-Version', 'v1');
  context.res.headers.set('X-Request-ID', 'req-123');

  // Use json() method
  const response = await context.res.json({ message: 'Hello' });

  // Verify headers are merged
  expect(response.headers.get('X-API-Version')).toBe('v1');
  expect(response.headers.get('X-Request-ID')).toBe('req-123');
  expect(response.headers.get('Content-Type')).toBe('application/json');
});

test('route returning ReadableStream produces a streaming response', async () => {
  const route = createRoute().get((_context: HS.Context) => {
    return new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('alpha'));
        controller.enqueue(enc.encode('beta'));
        controller.close();
      },
    });
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.body).toBeInstanceOf(ReadableStream);
  expect(response.headers.get('Transfer-Encoding')).toBe('chunked');
  expect(response.headers.get('Content-Encoding')).toBe('Identity');
  expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  expect(await response.text()).toBe('alphabeta');
});

test('route returning ReadableStream respects Content-Type set on context.res.headers', async () => {
  const route = createRoute().get((context: HS.Context) => {
    context.res.headers.set('Content-Type', 'text/plain; charset=UTF-8');
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ok'));
        controller.close();
      },
    });
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get('Transfer-Encoding')).toBe('chunked');
  expect(response.headers.get('Content-Encoding')).toBe('Identity');
  expect(response.headers.get('Content-Type')).toBe('text/plain; charset=UTF-8');
  expect(await response.text()).toBe('ok');
});

test('route returning AsyncGenerator produces a streaming response', async () => {
  async function* streamingHandler() {
    yield '<h1>Hello</h1>';
    yield '<p>World</p>';
    yield '<p>Streaming</p>';
  }

  const route = createRoute().get(async (_context: HS.Context) => {
    return streamingHandler();
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get('Transfer-Encoding')).toBe('chunked');
  expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');

  const text = await response.text();
  expect(text).toBe('<h1>Hello</h1><p>World</p><p>Streaming</p>');
});

test('route returning a sync Generator produces a streaming response', async () => {
  function* streamingHandler() {
    yield '<h1>Hello</h1>';
    yield '<p>World</p>';
    yield '<p>Streaming</p>';
  }

  const route = createRoute().get((_context: HS.Context) => {
    return streamingHandler();
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get('Transfer-Encoding')).toBe('chunked');
  expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');

  const text = await response.text();
  expect(text).toBe('<h1>Hello</h1><p>World</p><p>Streaming</p>');
});

test('route returning a Generator respects Content-Type set on context.res.headers', async () => {
  async function* streamingHandler() {
    yield 'Hello';
    yield ' World';
  }

  const route = createRoute().get((context: HS.Context) => {
    context.res.headers.set('Content-Type', 'text/plain');
    return streamingHandler();
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get('Transfer-Encoding')).toBe('chunked');
  expect(response.headers.get('Content-Type')).toBe('text/plain');

  const text = await response.text();
  expect(text).toBe('Hello World');
});

test('createContext() merge() function allows response headers to override context headers', async () => {
  const request = new Request('http://localhost:3000/');
  const context = createContext(request);

  // Set a header on context
  context.res.headers.set('X-Header', 'context-value');

  // Use html() with options that include the same header (should override)
  const response = await context.res.html('<h1>Test</h1>', {
    headers: {
      'X-Header': 'response-value',
    },
  });

  // Response header should override context header
  expect(response.headers.get('X-Header')).toBe('response-value');
  expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
});

describe('when streaming is disabled', () => {
  test('placeholder resolves to real content in the initial response on the route', async () => {
    const route = createRoute({
      responseOptions: {
        disableStreaming: () => true,
      },
    }).get(() => {
      return html`<div>
        ${placeholder(html`<span>Loading...</span>`, Promise.resolve(html`<p>Real content</p>`))}
      </div>`;
    });

    const request = new Request('http://localhost:3000/');
    const response = await route.fetch(request);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

    const text = await response.text();
    expect(text).toContain('<p>Real content</p>');
    expect(text).not.toContain('Loading...');
    expect(text).not.toContain('hs:loading');
  });

  test('placeholder resolves to real content in the initial response on the server', async () => {
    const server = await createServer({
      appDir: './app',
      publicDir: './public',
      plugins: [],
      responseOptions: {
        disableStreaming: () => true,
      },
    });

    server.get('/', () => {
      return html`<div>
        ${placeholder(html`<span>Loading...</span>`, Promise.resolve(html`<p>Real content</p>`))}
      </div>`;
    });

    const route = server._routes[0];
    route._serverConfig = server._config;

    const request = new Request('http://localhost:3000/');
    const response = await route.fetch(request);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

    const text = await response.text();
    expect(text).toContain('<p>Real content</p>');
    expect(text).not.toContain('Loading...');
    expect(text).not.toContain('hs:loading');
  });

  test('disableStreaming receives hyperspanDisableStreaming for custom logic with framework fallback', async () => {
    const route = createRoute({
      responseOptions: {
        disableStreaming(c, { hyperspanDisableStreaming }) {
          if (c.req.query.get('no-stream') === '1') {
            return true;
          }
          return hyperspanDisableStreaming(c);
        },
      },
    }).get(() => {
      return html`<div>
        ${placeholder(html`<span>Loading...</span>`, Promise.resolve(html`<p>Real content</p>`))}
      </div>`;
    });

    const normalRequest = new Request('http://localhost:3000/');
    const normalResponse = await route.fetch(normalRequest);
    expect(normalResponse.headers.get('Transfer-Encoding')).toBe('chunked');

    const customRequest = new Request('http://localhost:3000/?no-stream=1');
    const customResponse = await route.fetch(customRequest);
    expect(customResponse.headers.get('Transfer-Encoding')).not.toBe('chunked');
    expect(await customResponse.text()).toContain('<p>Real content</p>');

    const botRequest = new Request('http://localhost:3000/', {
      headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
    });
    const botResponse = await route.fetch(botRequest);
    expect(botResponse.headers.get('Transfer-Encoding')).not.toBe('chunked');
    expect(await botResponse.text()).toContain('<p>Real content</p>');
  });

  test('nested promise and placeholder content fully resolves on initial load', async () => {
    const route = createRoute({
      responseOptions: {
        disableStreaming: () => true,
      },
    }).get(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sectionPromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return placeholder(
          html`<span>Outer placeholder</span>`,
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return html`<p>Inner resolved content</p>`;
          })()
        );
      })();

      return html`<main>
        <h1>Static heading</h1>
        ${sectionPromise}
      </main>`;
    });

    const request = new Request('http://localhost:3000/');
    const response = await route.fetch(request);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

    const text = await response.text();
    expect(text).toContain('<h1>Static heading</h1>');
    expect(text).toContain('<p>Inner resolved content</p>');
    expect(text).not.toContain('Outer placeholder');
    expect(text).not.toContain('hs:loading');
  });

  test('nested promise and async action form fully resolve on initial load', async () => {
    const action = createAction({ name: 'nested-async-form-action' })
      .form(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return html`<form>
          <p>Action form content</p>
          <button type="submit">Submit</button>
        </form>`;
      })
      .post(async () => html`<p>Submitted</p>`);

    const route = createRoute({
      responseOptions: {
        disableStreaming: () => true,
      },
    }).get(async (c: HS.Context) => {
      await new Promise((resolve) => setTimeout(resolve, 10));

      const sectionPromise = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return placeholder(
          html`<span>Outer placeholder</span>`,
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return action.render(c);
          })()
        );
      })();

      return html`<main>
        <h1>Static heading</h1>
        ${sectionPromise}
      </main>`;
    });

    const request = new Request('http://localhost:3000/');
    const response = await route.fetch(request);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

    const text = await response.text();
    expect(text).toContain('<h1>Static heading</h1>');
    expect(text).toContain('<hs-action');
    expect(text).toContain('<p>Action form content</p>');
    expect(text).toContain('type="submit"');
    expect(text).not.toContain('Outer placeholder');
    expect(text).not.toContain('hs:loading');
  });
});

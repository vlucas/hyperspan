import { test, expect } from 'bun:test';
import { createRoute, createServer, createContext } from './server';
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

  const route = server._routes.find((route: HS.Route) => route._path() === '/users' && route._methods().includes('POST')) as HS.Route;
  const request = new Request('http://localhost:3000/users', { method: 'POST' });
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>POST /users</h1>');
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
      'Cookie': 'sessionId=abc123; theme=dark; userId=42',
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

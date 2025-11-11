import { test, expect } from 'bun:test';
import { createRoute, createServer } from './server';
import type { Hyperspan as HS } from './types';

test('route fetch() returns a Response', async () => {
  const route = createRoute().get((context) => {
    return context.res.html('<h1>Hello World</h1>');
  });

  const request = new Request('http://localhost:3000/');
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>Hello World</h1>');
});

test('server with two routes can return Response from one', async () => {
  const server = createServer({
    appDir: './app',
    staticFileRoot: './public',
  });

  // Add two routes to the server
  server.get('/users', (context) => {
    return context.res.html('<h1>Users Page</h1>');
  });

  server.get('/posts', (context) => {
    return context.res.html('<h1>Posts Page</h1>');
  });


  // Test that we can get a Response from one of the routes
  const request = new Request('http://localhost:3000/users');
  const testRoute = server._routes.find((route) => route._path === '/users');
  const response = await testRoute!.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Users Page');
});

test('server returns a route with a POST request', async () => {
  const server = createServer({
    appDir: './app',
    staticFileRoot: './public',
  });

  // Add two routes to the server
  server.get('/users', (context) => {
    return context.res.html('<h1>GET /users</h1>');
  });

  server.post('/users', (context) => {
    return context.res.html('<h1>POST /users</h1>');
  });

  const route = server._routes.find((route) => route._path === '/users' && route._methods().includes('POST')) as HS.Route;
  const request = new Request('http://localhost:3000/', { method: 'POST' });
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('<h1>POST /users</h1>');
});

test('returns 405 when route path matches but HTTP method does not', async () => {
  const server = createServer({
    appDir: './app',
    staticFileRoot: './public',
  });

  // Route registered for GET only
  server.get('/users', (context) => {
    return context.res.html('<h1>Users Page</h1>');
  });

  // Attempt to POST to /users, which should return 405
  const route = server._routes.find((route) => route._path === '/users')!;
  const request = new Request('http://localhost:3000/users', { method: 'POST' });
  const response = await route.fetch(request);

  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(405);
  const text = await response.text();
  expect(text).toContain('Method not allowed');
});

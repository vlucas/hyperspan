import { describe, expect, test } from 'vitest';
import { createRoute, createServer } from './server';
import { createFetchHandler, compileRoutePath } from './fetch-handler';
import type { Hyperspan as HS } from './types';

describe('compileRoutePath', () => {
  test('matches static paths', () => {
    const { pattern } = compileRoutePath('/about');
    expect('/about'.match(pattern)).toBeTruthy();
    expect('/about/'.match(pattern)).toBeTruthy();
  });

  test('matches dynamic params', () => {
    const { pattern, paramNames } = compileRoutePath('/users/:id');
    expect(paramNames).toEqual(['id']);
    const match = '/users/42'.match(pattern);
    expect(match?.[1]).toBe('42');
  });

  test('matches wildcard routes', () => {
    const { pattern, paramNames } = compileRoutePath('/blog/*');
    expect(paramNames).toEqual(['...slug']);
    const match = '/blog/hello/world'.match(pattern);
    expect(match?.[1]).toBe('hello/world');
  });
});

describe('createFetchHandler', () => {
  test('routes GET requests to matching handler', async () => {
    const server = await createServer({
      appDir: './app',
      publicDir: './public',
      plugins: [],
    });

    server.get('/hello', (c: HS.Context) => c.res.html('<h1>Hello</h1>'));

    const fetch = createFetchHandler(server);
    const response = await fetch(new Request('http://localhost/hello'));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>Hello</h1>');
  });

  test('returns 404 for unknown paths', async () => {
    const server = await createServer({
      appDir: './app',
      publicDir: './public',
      plugins: [],
    });

    const fetch = createFetchHandler(server);
    const response = await fetch(new Request('http://localhost/missing'));

    expect(response.status).toBe(404);
  });

  test('passes route params to context', async () => {
    const server = await createServer({
      appDir: './app',
      publicDir: './public',
      plugins: [],
    });

    const route = createRoute({ path: '/items/:id' }).get((c: HS.Context) =>
      c.res.text(c.route.params.id ?? '')
    );
    server._routes.push(route);

    const fetch = createFetchHandler(server);
    const response = await fetch(new Request('http://localhost/items/abc'));

    expect(await response.text()).toBe('abc');
  });

  test('redirects trailing slashes', async () => {
    const server = await createServer({
      appDir: './app',
      publicDir: './public',
      plugins: [],
    });

    server.get('/page', (c: HS.Context) => c.res.text('ok'));

    const fetch = createFetchHandler(server);
    const response = await fetch(new Request('http://localhost/page/', { redirect: 'manual' }));

    expect(response.status).toBe(308);
  });
});

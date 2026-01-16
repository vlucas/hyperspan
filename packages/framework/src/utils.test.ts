import { test, expect, describe } from 'bun:test';
import { formDataToJSON, parsePath } from './utils';

describe('formDataToJSON', () => {
  test('formDataToJSON returns empty object for empty FormData', () => {
    const formData = new FormData();
    const result = formDataToJSON(formData);

    expect(result).toEqual({});
  });

  test('formDataToJSON handles simple FormData object', () => {
    const formData = new FormData();
    formData.append('name', 'John Doe');
    formData.append('email', 'john@example.com');
    formData.append('age', '30');

    const result = formDataToJSON(formData);

    expect(result).toEqual({
      name: 'John Doe',
      email: 'john@example.com',
      age: '30',
    });
  });

  test('formDataToJSON handles complex FormData with nested fields', () => {
    const formData = new FormData();
    formData.append('user[firstName]', 'John');
    formData.append('user[lastName]', 'Doe');
    formData.append('user[email]', 'john@example.com');
    formData.append('user[address][street]', '123 Main St');
    formData.append('user[address][city]', 'New York');
    formData.append('user[address][zip]', '10001');

    const result = formDataToJSON(formData);

    expect(result).toEqual({
      user: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        address: {
          street: '123 Main St',
          city: 'New York',
          zip: '10001',
        },
      },
    } as any);
  });

  test('formDataToJSON handles FormData with array of values', () => {
    const formData = new FormData();
    formData.append('tags', 'javascript');
    formData.append('tags', 'typescript');
    formData.append('tags', 'nodejs');
    formData.append('colors[]', 'red');
    formData.append('colors[]', 'green');
    formData.append('colors[]', 'blue');

    const result = formDataToJSON(formData);

    expect(result).toEqual({
      tags: ['javascript', 'typescript', 'nodejs'],
      colors: ['red', 'green', 'blue'],
    });
  });
});

describe('parsePath', () => {
  test('parsePath returns root path for empty string', () => {
    const result = parsePath('');
    expect(result.path).toBe('/');
    expect(result.params).toEqual([]);
  });

  test('parsePath handles simple path', () => {
    const result = parsePath('users');
    expect(result.path).toBe('/users');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes leading slash', () => {
    const result = parsePath('/users');
    expect(result.path).toBe('/users');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes trailing slash', () => {
    const result = parsePath('users/');
    expect(result.path).toBe('/users');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes both leading and trailing slashes', () => {
    const result = parsePath('/users/');
    expect(result.path).toBe('/users');
    expect(result.params).toEqual([]);
  });

  test('parsePath handles nested paths', () => {
    const result = parsePath('users/posts');
    expect(result.path).toBe('/users/posts');
    expect(result.params).toEqual([]);
  });

  test('parsePath lowercases path segments', () => {
    const result = parsePath('Users/Posts');
    expect(result.path).toBe('/users/posts');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes .ts extension', () => {
    const result = parsePath('users.ts');
    expect(result.path).toBe('/users');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes .js extension', () => {
    const result = parsePath('users.js');
    expect(result.path).toBe('/users');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes index from path', () => {
    const result = parsePath('index');
    expect(result.path).toBe('/');
    expect(result.params).toEqual([]);
  });

  test('parsePath removes index.ts from path', () => {
    const result = parsePath('index.ts');
    expect(result.path).toBe('/');
    expect(result.params).toEqual([]);
  });

  test('parsePath handles dynamic param with brackets', () => {
    const result = parsePath('users/[userId]');
    expect(result.path).toBe('/users/:userId');
    expect(result.params).toEqual(['userId']);
  });

  test('parsePath handles multiple dynamic params', () => {
    const result = parsePath('users/[userId]/posts/[postId]');
    expect(result.path).toBe('/users/:userId/posts/:postId');
    expect(result.params).toEqual(['userId', 'postId']);
  });

  test('parsePath handles catch-all param with spread', () => {
    const result = parsePath('users/[...slug]');
    expect(result.path).toBe('/users/*');
    expect(result.params).toEqual(['...slug']);
  });

  test('parsePath handles catch-all param at root', () => {
    const result = parsePath('[...slug]');
    expect(result.path).toBe('/*');
    expect(result.params).toEqual(['...slug']);
  });

  test('parsePath preserves param names in path but converts format', () => {
    const result = parsePath('users/[userId]');
    expect(result.path).toBe('/users/:userId');
    expect(result.params).toEqual(['userId']);
    // Param segment should not be lowercased
    expect(result.path).toContain(':userId');
  });

  test('parsePath handles complex nested path with params', () => {
    const result = parsePath('/api/users/[userId]/posts/[postId]/comments');
    expect(result.path).toBe('/api/users/:userId/posts/:postId/comments');
    expect(result.params).toEqual(['userId', 'postId']);
  });

  test('parsePath handles path with dots in param name', () => {
    const result = parsePath('users/[user.id]');
    expect(result.path).toBe('/users/:user.id');
    expect(result.params).toEqual(['user.id']);
  });

  test('parsePath handles mixed case with params', () => {
    const result = parsePath('Users/[UserId]/Posts');
    expect(result.path).toBe('/users/:UserId/posts');
    expect(result.params).toEqual(['UserId']);
    // Non-param segments should be lowercased, but param name preserved
    expect(result.path).toContain('/users/');
    expect(result.path).toContain('/posts');
  });

  test('parsePath handles file path format', () => {
    const result = parsePath('/routes/users/[userId].ts');
    expect(result.path).toBe('/routes/users/:userId');
    expect(result.params).toEqual(['userId']);
  });
});


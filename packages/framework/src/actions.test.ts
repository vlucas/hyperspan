import { test, expect, describe } from 'bun:test';
import { formDataToJSON, createAction } from './actions';
import { html, render, type HSHtml } from '@hyperspan/html';
import { createContext } from './server';
import type { Hyperspan as HS } from './types';
import * as z from 'zod/v4';

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

describe('createAction', () => {
  test('creates an action with a simple form and no schema', async () => {
    const action = createAction({
      form: (c: HS.Context) => {
        return html`
          <form>
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        `;
      },
    });

    expect(action).toBeDefined();
    expect(action._kind).toBe('hsAction');
    expect(action._route).toContain('/__actions/');

    // Test render method
    const request = new Request('http://localhost:3000/');
    const context = createContext(request);
    const rendered = render(action.render(context) as HSHtml);

    expect(rendered).not.toBeNull();
    const htmlString = rendered;
    expect(htmlString).toContain('<hs-action');
    expect(htmlString).toContain('name="name"');
  });

  test('creates an action with a Zod schema matching form inputs', async () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.email('Invalid email address'),
    });

    const action = createAction({
      schema,
      form: (c: HS.Context, { data }) => {
        return html`
          <form>
            <input type="text" name="name" value="${data?.name || ''}" />
            <input type="email" name="email" value="${data?.email || ''}" />
            <button type="submit">Submit</button>
          </form>
        `;
      },
    }).post(async (c: HS.Context, { data }) => {
      return c.res.html(`
        <p>Hello, ${data?.name}!</p>
        <p>Your email is ${data?.email}.</p>
      `);
    });

    expect(action).toBeDefined();
    expect(action._kind).toBe('hsAction');
    expect(action._route).toContain('/__actions/');

    // Test render method
    const request = new Request('http://localhost:3000/');
    const context = createContext(request);
    const rendered = action.render(context);

    expect(rendered).not.toBeNull();
    const htmlString = render(rendered as unknown as HSHtml);
    expect(htmlString).toContain('name="name"');
    expect(htmlString).toContain('name="email"');

    // Test fetch method with POST request to trigger validation
    const formData = new FormData();
    formData.append('name', 'John Doe');
    formData.append('email', 'john@example.com');

    const postRequest = new Request(`http://localhost:3000${action._route}`, {
      method: 'POST',
      body: formData,
    });

    const response = await action.fetch(postRequest);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);

    const responseText = await response.text();
    expect(responseText).toContain('Hello, John Doe!');
    expect(responseText).toContain('Your email is john@example.com.');
  });

  test('re-renders form with error when schema validation fails', async () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.email('Invalid email address'),
    });

    const action = createAction({
      schema,
      form: (c: HS.Context, { data, error }) => {
        return html`
          <form>
            <input type="text" name="name" value="${data?.name || ''}" />
            ${error ? html`<div class="error">Validation failed</div>` : ''}
            <input type="email" name="email" value="${data?.email || ''}" />
            <button type="submit">Submit</button>
          </form>
        `;
      },
    }).post(async (c: HS.Context, { data }) => {
      return c.res.html(`
        <p>Hello, ${data?.name}!</p>
        <p>Your email is ${data?.email}.</p>
      `);
    });

    // Test fetch method with invalid data (missing name, invalid email)
    const formData = new FormData();
    formData.append('email', 'not-an-email');

    const postRequest = new Request(`http://localhost:3000${action._route}`, {
      method: 'POST',
      body: formData,
    });

    const response = await action.fetch(postRequest);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);

    const responseText = await response.text();
    // Should re-render the form, not the post handler output
    expect(responseText).toContain('name="name"');
    expect(responseText).toContain('name="email"');
    expect(responseText).toContain('Validation failed');
    // Should NOT contain the success message from post handler
    expect(responseText).not.toContain('Hello,');
  });
});


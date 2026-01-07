import { test, expect, describe } from 'bun:test';
import { createAction } from './actions';
import { html, render, type HSHtml } from '@hyperspan/html';
import { createContext } from './server';
import type { Hyperspan as HS } from './types';
import * as z from 'zod/v4';

describe('createAction', () => {
  test('creates an action with a simple form and no schema', async () => {
    const action = createAction({
      name: 'test',
      schema: z.object({
        name: z.string().min(1, 'Name is required'),
      }),
    }).form((c) => {
      return html`
          <form>
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        `;
    }).post(async (c, { data }) => {
      return c.res.html(`
          <p>Hello, ${data?.name}!</p>
        `);
    });

    expect(action).toBeDefined();
    expect(action._kind).toBe('hsAction');
    expect(action._path()).toContain('/__actions/');

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
      name: 'test',
      schema,
    }).form((c, { data }) => {
      return html`
          <form>
            <input type="text" name="name" />
            <input type="email" name="email" />
            <button type="submit">Submit</button>
          </form>
        `;
    }).post(async (c, { data }) => {
      return c.res.html(`
        <p>Hello, ${data?.name}!</p>
        <p>Your email is ${data?.email}.</p>
      `);
    });

    expect(action).toBeDefined();
    expect(action._kind).toBe('hsAction');
    expect(action._path()).toContain('/__actions/');

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

    const postRequest = new Request(`http://localhost:3000${action._path()}`, {
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
      name: 'test',
      schema,
    }).form((c, { data, error }) => {
      return html`
          <form>
            <input type="text" name="name" value="${data?.name || ''}" />
            ${error ? html`<div class="error">Validation failed</div>` : ''}
            <input type="email" name="email" value="${data?.email || ''}" />
            <button type="submit">Submit</button>
          </form>
        `;
    }).post(async (c, { data }) => {
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


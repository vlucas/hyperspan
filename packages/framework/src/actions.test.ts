import { test, expect, describe } from 'bun:test';
import { createAction } from './actions';
import { createRoute } from './server';
import { html, render, placeholder, type HSHtml } from '@hyperspan/html';
import { createContext } from './server';
import * as z from 'zod';

describe('createAction', () => {
  test('creates an action with a simple form and no schema', async () => {
    const action = createAction({
      name: 'test',
      schema: z.object({
        name: z.string().min(1, 'Name is required'),
      }),
    })
      .form((c) => {
        return html`
          <form>
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
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

  test('creates an action with a simple form and no schema that returns HTML on POST', async () => {
    const action = createAction({
      name: 'test',
    })
      .form((c) => {
        return html`
          <form>
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
        return c.res.html(`
          <p>Hello, ${data?.name}!</p>
        `);
      });

    // Build form data
    const formData = new FormData();
    formData.append('name', 'John Doe');

    // Test render method
    const request = new Request(`http://localhost:3000${action._path()}`, {
      method: 'POST',
      body: formData,
    });
    const response = await action.fetch(request);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).toContain('<p>Hello, John Doe!</p>');
  });

  test('returns HSHtml directly from POST handler', async () => {
    const action = createAction({
      name: 'test',
    })
      .form((c) => {
        return html`
          <form>
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
        return html`<p>Hello, ${data?.name}!</p>`;
      });

    const formData = new FormData();
    formData.append('name', 'Jane Doe');

    const request = new Request(`http://localhost:3000${action._path()}`, {
      method: 'POST',
      body: formData,
    });
    const response = await action.fetch(request);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).toContain('<p>Hello, Jane Doe!</p>');
  });

  test('errors thrown on POST handler provided by user are caught and rendered', async () => {
    const action = createAction({
      name: 'test',
    })
      .form((c, { error }) => {
        if (error) {
          return html` <p>Error: ${error.message}</p> `;
        }

        return html`
          <form>
            <input type="text" name="name" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
        throw new Error('Test error');
      });

    // Build form data
    const formData = new FormData();
    formData.append('name', 'John Doe');

    // Test render method
    const request = new Request(`http://localhost:3000${action._path()}`, {
      method: 'POST',
      body: formData,
    });
    const response = await action.fetch(request);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(responseText).toContain('<p>Error: Test error</p>');
  });

  test('creates an action with a Zod schema matching form inputs', async () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.email('Invalid email address'),
    });

    const action = createAction({
      name: 'test',
      schema,
    })
      .form((c, { data }) => {
        return html`
          <form>
            <input type="text" name="name" />
            <input type="email" name="email" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
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
    })
      .form((c, { data, error }) => {
        return html`
          <form>
            <input type="text" name="name" value="${data?.name || ''}" />
            ${error ? html`<div class="error">Validation failed</div>` : ''}
            <input type="email" name="email" value="${data?.email || ''}" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
        return c.res.html(`
        <p>Hello, ${data?.name}!</p>
        <p>Your email is ${data?.email}.</p>
      `);
      });

    // Test fetch method with invalid data (missing name, invalid email)
    const formData = new FormData();
    formData.append('email', 'not-an-email');

    const postRequest = new Request(`http://localhost:3000${action._path()}`, {
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

  test('uses custom error handler when provided', async () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.email('Invalid email address'),
    });

    const action = createAction({
      name: 'test',
      schema,
    })
      .form((c, { data, error }) => {
        return html`
          <form>
            <input type="text" name="name" value="${data?.name || ''}" />
            ${error ? html`<div class="error">Validation failed</div>` : ''}
            <input type="email" name="email" value="${data?.email || ''}" />
            <button type="submit">Submit</button>
          </form>
        `;
      })
      .post(async (c, { data }) => {
        return html`
          <p>Hello, ${data?.name}!</p>
          <p>Your email is ${data?.email}.</p>
        `;
      })
      .errorHandler(async (c, { data, error }) => {
        return html`
          <p>Caught error in custom error handler: ${error?.message}</p>
          <p>Data: ${JSON.stringify(data)}</p>
        `;
      });

    // Test fetch method with invalid data (missing name, invalid email)
    const formData = new FormData();
    formData.append('email', 'not-an-email');

    const postRequest = new Request(`http://localhost:3000${action._path()}`, {
      method: 'POST',
      body: formData,
    });

    const response = await action.fetch(postRequest);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);

    const responseText = await response.text();
    // Should render the custom error handler
    expect(responseText).toContain('Invalid email address');
    // Should NOT contain the success message from post handler
    expect(responseText).not.toContain('Hello,');
  });

  describe('when streaming is disabled', () => {
    test('action POST returns resolved placeholder content on the route', async () => {
      const action = createAction({ name: 'async-placeholder-action-route' })
        .form(() => html`<form><button type="submit">Submit</button></form>`)
        .post(async () => {
          return html`<div>
            ${placeholder(
              html`<span>Saving...</span>`,
              (async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return html`<p>Action complete</p>`;
              })()
            )}
          </div>`;
        });

      action._config.responseOptions = {
        disableStreaming: () => true,
      };

      const request = new Request(`http://localhost:3000${action._path()}`, {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          'X-Request-Type': 'partial',
        },
        body: new FormData(),
      });

      const response = await action.fetch(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

      const text = await response.text();
      expect(text).toContain('<p>Action complete</p>');
      expect(text).not.toContain('Saving...');
      expect(text).not.toContain('hs:loading');
    });

    test('action POST returns resolved placeholder content on the server', async () => {
      const action = createAction({ name: 'async-placeholder-action-server' })
        .form(() => html`<form><button type="submit">Submit</button></form>`)
        .post(async () => {
          return html`<div>
            ${placeholder(
              html`<span>Saving...</span>`,
              (async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return html`<p>Action complete</p>`;
              })()
            )}
          </div>`;
        });

      action._serverConfig = {
        appDir: './app',
        publicDir: './public',
        plugins: [],
        responseOptions: {
          disableStreaming: () => true,
        },
      };

      const request = new Request(`http://localhost:3000${action._path()}`, {
        method: 'POST',
        headers: {
          Accept: 'text/html',
          'X-Request-Type': 'partial',
        },
        body: new FormData(),
      });

      const response = await action.fetch(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

      const text = await response.text();
      expect(text).toContain('<p>Action complete</p>');
      expect(text).not.toContain('Saving...');
      expect(text).not.toContain('hs:loading');
    });

    test('action GET returns resolved placeholder content on the server', async () => {
      const action = createAction({ name: 'async-placeholder-action-get' })
        .form(() => {
          return html`<div>
            ${placeholder(html`<span>Loading...</span>`, Promise.resolve(html`<p>Form ready</p>`))}
          </div>`;
        })
        .post(async () => html`<p>Action complete</p>`);

      action._serverConfig = {
        appDir: './app',
        publicDir: './public',
        plugins: [],
        responseOptions: {
          disableStreaming: () => true,
        },
      };

      const response = await action.fetch(new Request(`http://localhost:3000${action._path()}`));

      expect(response.status).toBe(200);
      expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

      const text = await response.text();
      expect(text).toContain('<p>Form ready</p>');
      expect(text).not.toContain('Loading...');
      expect(text).not.toContain('hs:loading');
    });

    test('embedded action.render() uses the parent page route streaming config, not the action server config', async () => {
      const action = createAction({ name: 'embedded-action-streaming' })
        .form(() => {
          return html`<div>
            ${placeholder(html`<span>Loading...</span>`, Promise.resolve(html`<p>Form ready</p>`))}
          </div>`;
        })
        .post(async () => html`<p>Action complete</p>`);

      action._serverConfig = {
        appDir: './app',
        publicDir: './public',
        plugins: [],
        responseOptions: {
          disableStreaming: () => true,
        },
      };

      const pageRoute = createRoute().get((c) => html`<main>${action.render(c)}</main>`);
      let pageResponse = await pageRoute.fetch(new Request('http://localhost:3000/'));
      expect(pageResponse.headers.get('Transfer-Encoding')).toBe('chunked');
      expect(await pageResponse.text()).toContain('Loading...');

      pageRoute._serverConfig = {
        appDir: './app',
        publicDir: './public',
        plugins: [],
        responseOptions: {
          disableStreaming: () => true,
        },
      };

      pageResponse = await pageRoute.fetch(new Request('http://localhost:3000/'));
      expect(pageResponse.headers.get('Transfer-Encoding')).not.toBe('chunked');

      const text = await pageResponse.text();
      expect(text).toContain('<p>Form ready</p>');
      expect(text).not.toContain('Loading...');
    });

    test('action validation error re-render returns resolved placeholder content', async () => {
      const schema = z.object({ name: z.string().min(1, 'Name is required') });

      const action = createAction({ name: 'async-placeholder-action-error', schema })
        .form(
          (c, { error }) => html`
            <form>
              <div>
                ${placeholder(
                  html`<span>Loading...</span>`,
                  Promise.resolve(html`<p>Form ready</p>`)
                )}
              </div>
              ${error ? html`<p class="error">${error.message}</p>` : ''}
              <button type="submit">Submit</button>
            </form>
          `
        )
        .post(async () => html`<p>Action complete</p>`);

      action._serverConfig = {
        appDir: './app',
        publicDir: './public',
        plugins: [],
        responseOptions: {
          disableStreaming: () => true,
        },
      };

      const response = await action.fetch(
        new Request(`http://localhost:3000${action._path()}`, {
          method: 'POST',
          headers: {
            Accept: 'text/html',
            'X-Request-Type': 'partial',
          },
          body: new FormData(),
        })
      );

      expect(response.status).toBe(400);
      expect(response.headers.get('Transfer-Encoding')).not.toBe('chunked');

      const text = await response.text();
      expect(text).toContain('<p>Form ready</p>');
      expect(text).not.toContain('Loading...');
      expect(text).toContain('class="error"');
    });
  });
});

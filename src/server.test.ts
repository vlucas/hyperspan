import { describe, it, expect } from 'bun:test';
import { html, renderToString } from './html';
import { createForm } from './server';
import { HSRequestContext } from './app';

describe('server', () => {
  describe('createForm', () => {
    it('should return the form with form()', async () => {
      const testUrl = 'http://localhost:3005/form';
      const ctx = new HSRequestContext(new Request(testUrl));
      const form = createForm(() => html`<form><input type="text" name="username" /></form>`);
      const res = await form.form();

      expect(await renderToString(res)).toContain('name="username"');
    });

    it('should render the form on a GET', async () => {
      const testUrl = 'http://localhost:3005/form';
      const ctx = new HSRequestContext(new Request(testUrl));
      const form = createForm(() => html`<form><input type="text" name="username" /></form>`);
      const res = await form._handler['GET'](ctx);

      expect(await renderToString(res)).toContain('name="username"');
    });
  });
});

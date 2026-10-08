import { describe, expect, test } from 'vitest';
import { html, placeholder, render, type HSHtml } from './html';

describe('@hyperspan/framework/html', () => {
  test('re-exports html helpers and types from @hyperspan/html', () => {
    const tmpl: HSHtml = html`<p>
      ${placeholder(html`<span>loading</span>`, Promise.resolve('ok'))}
    </p>`;

    expect(render(tmpl)).toContain('<p>');
    expect(render(tmpl)).toContain('loading');
  });
});

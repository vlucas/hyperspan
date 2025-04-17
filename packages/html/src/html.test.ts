import { it, describe, expect } from 'bun:test';
import { html, render } from './html';

describe('html templates', () => {
  const tmpl1 = html`<div>Template 1</div>`;
  const tmpl2 = html`<div>Template 2</div>`;
  const tmpl3 = html`<div>Template 3</div>`;

  it('should support nested templates', () => {
    const tmpl = html`<div>${tmpl1} ${tmpl2}</div>`;
    const content = render(tmpl);

    expect(content).toContain('Template 1');
    expect(content).toContain('Template 2');
    expect(content).not.toContain('&lt;');
  });

  it('will escape HTML content from values in a template', () => {
    const valueWithHTML = '<span>HTML content</span>';
    const tmpl = html`<div>${tmpl3} ${valueWithHTML}</div>`;
    const content = render(tmpl);

    expect(content).toContain('&lt;');
    expect(content).toContain('&gt;');
    expect(content).not.toContain('<span>');
  });

  it('will NOT escape HTML content from values in a template when html.raw() is used', () => {
    const valueWithHTML = '<span>HTML content</span>';
    const tmpl = html`<div>${tmpl3} ${html.raw(valueWithHTML)}</div>`;
    const content = render(tmpl);

    expect(content).not.toContain('&lt;');
    expect(content).not.toContain('&gt;');
    expect(content).toContain('<span>');
  });
});

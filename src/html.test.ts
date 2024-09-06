import { describe, it, expect } from 'bun:test';
import { compressHTMLString, html, renderToString, renderFunctionToString } from './html';

describe('html', () => {
  const htmlPromise1 = () => Promise.resolve('content_promise1');
  const htmlPromise2 = () => Promise.resolve('content_promise2');
  const asyncHtml1 = async () => html`<div>content_asynchtml1</div>`;
  const asyncNestedHtml1 = async () =>
    html`<div>content_asyncnestedhtml1</div>
      ${asyncHtml1()}`;

  it('should escape HTML by default', async () => {
    const testHtml = '<br />';
    const result = html`
      <ul>
        <li>${testHtml}</li>
        <li>${htmlPromise1()}</li>
      </ul>
    `;

    const content = compressHTMLString(await renderToString(result));

    expect(content).toContain('content_promise1');
  });

  it('should handle pure string templates', async () => {
    const result = html`<p>Hello World!</p>`;

    expect(await renderToString(result)).toEqual('<p>Hello World!</p>');
  });

  it('should handle arrays of strings', async () => {
    const testHtml = ['<br />', '<br />'];
    const result = html`<div>${testHtml}</div>`;

    expect(await renderToString(result)).toEqual('<div>&lt;br /&gt;&lt;br /&gt;</div>');
  });

  it('should handle nested async promises returning templates', async () => {
    const result = html`<div>${asyncNestedHtml1()}</div>`;
    const content = compressHTMLString(await renderToString(result));

    expect(content).toContain('content_asyncnestedhtml1');
    expect(content).toContain('content_asynchtml1');
  });

  // Streaming
  /*
  describe('streaming response', () => {
    it('should handle nested async promises returning templates', async () => {
      const result = html`<div>${asyncNestedHtml1()}</div>`;
      const stream = renderToStream(result);

      expect(stream).toEqual(
        '<div><div>content_asyncnestedhtml1</div><div>content_asynchtml1</div></div>'
      );
    });
  });
  */

  describe('renderFunctionToString', () => {
    it('should render fat arrow function to string', async () => {
      const fn = () => 'blah!';
      const fns = renderFunctionToString(fn);

      expect(fns).toEqual("function () { return 'blah'; }");
    });
  });
});

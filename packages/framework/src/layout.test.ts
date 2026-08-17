import { test, expect } from 'vitest';
import { render } from '@hyperspan/html';
import { hyperspanScriptTags } from './layout';
import { streamingClient } from './client/js';

test('streaming bootstrap injects a classic script so chunks swap in during parse', () => {
  const html = render(hyperspanScriptTags());
  expect(html).toContain("document.createElement('script')");
  expect(html).toContain(`script.src = '${streamingClient.publicPath}'`);
  expect(html).not.toContain("type = 'module'");
  expect(html).not.toContain(`import('${streamingClient.publicPath}')`);
});

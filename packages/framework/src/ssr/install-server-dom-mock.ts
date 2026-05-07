/**
 * Side-effect entry: install mock `window` / `document` before other framework imports run.
 * Imported first from `server.ts` so `document` / `window` references in user or 3p code do not throw on SSR.
 *
 * Opt out with `HYPERSPAN_DISABLE_MOCK_DOM=1` or `true`.
 */
import { installMockDom } from './mock-dom';

installMockDom();

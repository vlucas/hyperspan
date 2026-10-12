import { describe, expect, test } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { incomingRequestUrl, nodeIncomingToWebHeaders, nodeToWebRequest } from './node-http';

function fakeReq(headers: Record<string, string | string[]>, method = 'GET'): IncomingMessage {
  return { method, headers, url: '/' } as IncomingMessage;
}

describe('nodeToWebRequest', () => {
  test('preserves Cookie on the web Request (Node strips it by default)', () => {
    const req = fakeReq({
      host: 'app.test:8443',
      cookie: 'better-auth.session_token=abc',
      origin: 'https://app.test:8443',
    });
    const request = nodeToWebRequest(req, 'https://app.test:8443/app');
    expect(request.headers.get('cookie')).toBe('better-auth.session_token=abc');
    expect(request.headers.get('origin')).toBe('https://app.test:8443');
  });

  test('joins multiple Cookie headers with semicolons', () => {
    const headers = nodeIncomingToWebHeaders(
      fakeReq({ cookie: ['a=1', 'b=2'] })
    );
    expect(headers.get('cookie')).toBe('a=1; b=2');
  });
});

describe('incomingRequestUrl', () => {
  test('uses https from x-forwarded-proto', () => {
    const req = fakeReq({
      host: 'app.test:8443',
      'x-forwarded-proto': 'https',
    });
    expect(incomingRequestUrl(req, '/app')).toBe('https://app.test:8443/app');
  });
});

import { Context, Next } from 'hono';
import { etag } from 'hono/etag';
import timestring from 'timestring';

/**
 * Cache the response for a given time length ('30s', '1d', '1w', '1m', etc) or given number of seconds
 */
export function cacheTime(timeStrOrSeconds: string | number) {
  return (c: Context, next: Next) =>
    etag()(c, () => {
      // Only cache GET requests
      if (c.req.method.toUpperCase() === 'GET') {
        const timeInSeconds =
          typeof timeStrOrSeconds === 'number' ? timeStrOrSeconds : timestring(timeStrOrSeconds);
        c.header('Cache-Control', `public, max-age=${timeInSeconds}`);
      }
      return next();
    });
}

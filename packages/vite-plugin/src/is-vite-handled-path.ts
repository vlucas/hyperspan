/** Pathname extensions Vite should serve in middleware mode (not Hyperspan routes). */
const VITE_ASSET_EXT =
  /\.(tsx?|jsx?|mjs|cjs|json|css|vue|svelte|svg|png|jpe?g|gif|webp|woff2?|ttf|eot|ico|map)$/i;

/**
 * Whether a request URL should be left to Vite (HMR, modules, static assets)
 * instead of the Hyperspan fetch handler. Uses pathname only so query strings
 * like `?file=app.js` or paths like `/docs/introducing-typescript` are not skipped.
 */
export function isViteHandledPath(url: string): boolean {
  const pathname = (url.split('?')[0] ?? '/').split('#')[0] ?? '/';
  return (
    pathname.startsWith('/@') ||
    pathname.startsWith('/__vite') ||
    pathname.startsWith('/node_modules') ||
    VITE_ASSET_EXT.test(pathname)
  );
}

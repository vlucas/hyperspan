import type { ClientJSPathIdentity } from '@hyperspan/framework/client/js';

/**
 * A Worker has no `import.meta.resolve` and no `import.meta.url`, so it cannot turn a
 * path into a client script identity. A script registered from a path gets one hash at
 * build time (where the path is known) and a different one at runtime, which serves a
 * 404 for a file that is sitting in `dist/`.
 *
 * Fail the build instead, while the fix is still obvious.
 */
export function assertWorkerPortableClientJS(pathIdentities: ClientJSPathIdentity[]): void {
  if (pathIdentities.length === 0) {
    return;
  }

  const details = pathIdentities
    .map((item) => `  ${item.modulePath}\n    → identity "${item.identityKey}" (from a path)`)
    .join('\n');

  throw new Error(
    `[Hyperspan] ${pathIdentities.length} client script${pathIdentities.length === 1 ? '' : 's'} ` +
      `cannot be resolved on a Cloudflare Worker:\n${details}\n\n` +
      `Workers have no import.meta.resolve and no import.meta.url, so a path cannot be ` +
      `turned back into a script identity at runtime. Drop the import.meta.resolve() call ` +
      `and pass the specifier straight to buildClientJS, which the build resolves:\n\n` +
      `  await buildClientJS('~/app/client/my-client.ts')\n`
  );
}

/**
 * Workers have neither `import.meta.resolve` nor `import.meta.url` (both are
 * `undefined` in workerd). Wrangler emits a single module, so assigning here is
 * Worker-wide (`import.meta` is not on `globalThis`).
 *
 * There is no resolver and no base URL, so a Worker cannot turn a specifier into a
 * path. Path resolution is a build-time job; at runtime a client script is found by
 * looking its specifier up in the asset manifest.
 */

/**
 * Resolve against `base` when there is one, otherwise hand back the specifier.
 * Never throws: `new URL(specifier, undefined)` throws `Invalid URL string`, which
 * would crash the Worker at module load, before it can serve a request.
 */
export function resolveWithoutRuntimeResolver(specifier: string, base?: string): string {
  if (typeof base !== 'string' || base === '') {
    return specifier;
  }
  try {
    return new URL(specifier, base).href;
  } catch {
    return specifier;
  }
}

export function installImportMetaResolvePolyfill(): void {
  if (typeof import.meta.resolve === 'function') {
    return;
  }

  import.meta.resolve = function (specifier, parent) {
    return resolveWithoutRuntimeResolver(specifier, parent ?? import.meta.url);
  };
}

installImportMetaResolvePolyfill();

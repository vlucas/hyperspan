/**
 * Workers have `import.meta.url` but not `import.meta.resolve`.
 * Wrangler emits a single module, so assigning it here is Worker-wide
 * (`import.meta` is not on `globalThis`).
 *
 * This is a generic `new URL(specifier, parent)` polyfill. Client JS import-map
 * keys are a resolved-path identity; Vite/esbuild content-hash the emitted file.
 */
export function installImportMetaResolvePolyfill(): void {
  if (typeof import.meta.resolve === 'function') {
    return;
  }

  import.meta.resolve = function (specifier, parent) {
    return new URL(specifier, parent ?? import.meta.url).href;
  };
}

installImportMetaResolvePolyfill();

import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';
import { resolveAliasedSpecifier, resolveModuleAliases } from './tsconfig-aliases';

const VIRTUAL_ID = 'virtual:hyperspan-import-meta-resolve';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
const POLYFILL_MARKER = 'virtual:hyperspan-import-meta-resolve';

/**
 * Vite SSR's `import.meta` has no `resolve`. `__vite_ssr_import_meta__` is
 * per-module, not global, so it cannot be patched once. Prepend a `??=`
 * polyfill to modules that call `import.meta.resolve`.
 *
 * Relative specifiers use `new URL` (Node semantics). `~` and other tsconfig
 * paths go through the same alias map as the rest of the Vite plugin.
 * `createRequire().resolve` is not used — it cannot resolve `.ts` files.
 */
export function importMetaResolvePlugin(): Plugin {
  let aliases: Record<string, string> = {};

  return {
    name: 'hyperspan-import-meta-resolve',
    enforce: 'pre',

    configResolved(config) {
      aliases = resolveModuleAliases(config.root);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return;
      }

      const aliasesModule = fileURLToPath(new URL('./tsconfig-aliases.ts', import.meta.url));

      return `
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAliasedSpecifier } from ${JSON.stringify(aliasesModule)};

const aliases = ${JSON.stringify(aliases)};

export function hyperspanImportMetaResolve(specifier, base) {
  const aliased = resolveAliasedSpecifier(specifier, aliases);
  const resolved = aliased ?? specifier;
  if (resolved.startsWith('file:')) {
    return resolved;
  }
  if (isAbsolute(resolved)) {
    return pathToFileURL(resolved).href;
  }
  return new URL(resolved, base).href;
}
`;
    },

    transform(code, id) {
      if (id.includes('\0')) {
        return;
      }
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?')[0])) {
        return;
      }
      if (!code.includes('import.meta.resolve')) {
        return;
      }
      if (code.includes(POLYFILL_MARKER) && code.includes('import.meta.resolve ??=')) {
        return;
      }

      return {
        code: `import { hyperspanImportMetaResolve as __hsImportMetaResolve } from '${VIRTUAL_ID}';
import.meta.resolve ??= (specifier) => __hsImportMetaResolve(specifier, import.meta.url);
${code}`,
        map: null,
      };
    },
  };
}

/** Same resolution used at runtime by the SSR polyfill (for tests). */
export function hyperspanImportMetaResolve(
  specifier: string,
  base: string,
  aliases: Record<string, string> = {}
): string {
  const aliased = resolveAliasedSpecifier(specifier, aliases);
  const resolved = aliased ?? specifier;
  if (resolved.startsWith('file:')) {
    return resolved;
  }
  if (isAbsolute(resolved)) {
    return pathToFileURL(resolved).href;
  }
  return new URL(resolved, base).href;
}

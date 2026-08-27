import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCssImportSpecifiers } from './discover-css-imports';

/** Default stub path when resolved relative to project root (overwritten at sync time). */
export const CSS_STUB_RELATIVE_PATH =
  './node_modules/@hyperspan/adapter-cloudflare/stubs/empty.css';

export const MARKER_START = '# >>> hyperspan:css-aliases (auto-generated — do not edit)';
export const MARKER_END = '# <<< hyperspan:css-aliases';

export type SyncWranglerCssAliasesOptions = {
  appDir?: string;
  specifiers?: string[];
};

/**
 * Resolve the shipped empty CSS stub relative to the project root.
 */
export function resolveCssStubPath(root: string): string {
  const stubAbsolute = fileURLToPath(new URL('../../stubs/empty.css', import.meta.url));
  let rel = relative(root, stubAbsolute).replace(/\\/g, '/');
  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }
  return rel;
}

function findWranglerConfig(root: string): string | null {
  for (const name of ['wrangler.toml', 'wrangler.jsonc']) {
    const path = join(root, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function formatAliasBlock(specifiers: string[], stubPath: string): string {
  if (specifiers.length === 0) {
    return `${MARKER_START}\n# No CSS imports discovered in app sources.\n${MARKER_END}`;
  }

  const lines = specifiers.map((specifier) => `"${specifier}" = "${stubPath}"`);

  return `${MARKER_START}\n[alias]\n${lines.join('\n')}\n${MARKER_END}`;
}

function replaceOrAppendBlock(
  content: string,
  block: string
): { content: string; appended: boolean } {
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = content.slice(0, startIdx).replace(/\s+$/, '');
    const after = content.slice(endIdx + MARKER_END.length).replace(/^\s+/, '');
    const middle = block;
    const parts = [before, middle, after].filter((part) => part.length > 0);
    return { content: parts.join('\n\n') + '\n', appended: false };
  }

  const trimmed = content.replace(/\s+$/, '');
  const separator = trimmed.length > 0 ? '\n\n' : '';
  return { content: trimmed + separator + block + '\n', appended: true };
}

/**
 * Update wrangler.toml with CSS import aliases pointing to the shipped empty stub.
 */
export function syncWranglerCssAliases(
  root: string,
  options: SyncWranglerCssAliasesOptions = {}
): { updated: boolean; aliasCount: number; configPath?: string } {
  const specifiers =
    options.specifiers ?? discoverCssImportSpecifiers(root, options.appDir ?? './app');

  const stubPath = resolveCssStubPath(root);
  const configPath = findWranglerConfig(root);
  if (!configPath) {
    console.warn(
      '[Hyperspan] No wrangler.toml found — add the following block after creating wrangler.toml:\n'
    );
    console.warn(formatAliasBlock(specifiers, stubPath));
    return { updated: false, aliasCount: specifiers.length };
  }

  if (configPath.endsWith('.jsonc')) {
    console.warn(
      '[Hyperspan] wrangler.jsonc detected — automatic CSS alias sync supports wrangler.toml only.'
    );
    console.warn('Add aliases manually or switch to wrangler.toml:\n');
    console.warn(formatAliasBlock(specifiers, stubPath));
    return { updated: false, aliasCount: specifiers.length, configPath };
  }

  const content = readFileSync(configPath, 'utf-8');
  const block = formatAliasBlock(specifiers, stubPath);
  const { content: nextContent, appended } = replaceOrAppendBlock(content, block);
  if (nextContent === content) {
    return { updated: false, aliasCount: specifiers.length, configPath };
  }

  writeFileSync(configPath, nextContent);

  if (appended) {
    console.log('[Hyperspan] Added hyperspan:css-aliases block to wrangler.toml');
  }

  return { updated: true, aliasCount: specifiers.length, configPath };
}

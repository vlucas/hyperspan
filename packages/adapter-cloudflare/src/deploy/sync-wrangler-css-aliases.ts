import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCssImportSpecifiers } from './discover-css-imports';

/** Default stub path when resolved relative to project root (overwritten at sync time). */
export const CSS_STUB_RELATIVE_PATH =
  './node_modules/@hyperspan/adapter-cloudflare/stubs/empty.css';

export const MARKER_START = '// >>> hyperspan:css-aliases (auto-generated — do not edit)';
export const MARKER_END = '// <<< hyperspan:css-aliases';

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
  const path = join(root, 'wrangler.jsonc');
  return existsSync(path) ? path : null;
}

function formatAliasBlock(specifiers: string[], stubPath: string): string {
  if (specifiers.length === 0) {
    return `${MARKER_START}\n// No CSS imports discovered in app sources.\n${MARKER_END}`;
  }

  const entries = specifiers.map((specifier) => `    "${specifier}": "${stubPath}"`).join(',\n');
  return `${MARKER_START}\n  "alias": {\n${entries}\n  },\n${MARKER_END}`;
}

function replaceOrAppendBlock(
  content: string,
  block: string
): { content: string; appended: boolean } {
  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const existingBlock = content.slice(startIdx, endIdx + MARKER_END.length);
    if (existingBlock === block) {
      return { content, appended: false };
    }
    const before = content.slice(0, startIdx).replace(/\s+$/, '');
    const after = content.slice(endIdx + MARKER_END.length).replace(/^\s+/, '');
    const parts = [before, block, after].filter((part) => part.length > 0);
    return { content: parts.join('\n') + '\n', appended: false };
  }

  const trimmed = content.replace(/\s+$/, '');
  if (trimmed.endsWith('}')) {
    const beforeClose = trimmed.slice(0, -1).replace(/\s+$/, '');
    const needsComma =
      beforeClose.length > 1 && !beforeClose.endsWith('{') && !beforeClose.endsWith(',');
    const comma = needsComma ? ',' : '';
    const separator = beforeClose.endsWith('{') ? '\n' : `\n${comma}\n`;
    return { content: `${beforeClose}${separator}${block}\n}\n`, appended: true };
  }

  return { content: `${trimmed}\n\n${block}\n`, appended: true };
}

/**
 * Update wrangler.jsonc with CSS import aliases pointing to the shipped empty stub.
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
      '[Hyperspan] No wrangler.jsonc found — add the following block after creating wrangler.jsonc:\n'
    );
    console.warn(formatAliasBlock(specifiers, stubPath));
    return { updated: false, aliasCount: specifiers.length };
  }

  const content = readFileSync(configPath, 'utf-8');
  const block = formatAliasBlock(specifiers, stubPath);
  const { content: nextContent, appended } = replaceOrAppendBlock(content, block);
  if (nextContent === content) {
    return { updated: false, aliasCount: specifiers.length, configPath };
  }

  writeFileSync(configPath, nextContent);

  if (appended) {
    console.log('[Hyperspan] Added hyperspan:css-aliases block to wrangler.jsonc');
  }

  return { updated: true, aliasCount: specifiers.length, configPath };
}

import { existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';

const CSS_IMPORT_RE = /import\s+['"]([^'"]+\.(?:css|scss|sass|less))['"]/g;

const STYLE_EXT = /\.(css|scss|sass|less)$/;

/**
 * Extract static CSS import specifiers from a source file.
 */
export function extractCssImportsFromSource(source: string): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;
  CSS_IMPORT_RE.lastIndex = 0;
  while ((match = CSS_IMPORT_RE.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * Expand a CSS import into all alias keys esbuild may resolve when bundling the Worker.
 */
export function expandCssImportSpecifiers(
  root: string,
  importerFile: string,
  specifier: string
): string[] {
  const keys = new Set<string>();
  keys.add(specifier);

  if (specifier.startsWith('~/')) {
    const withoutTilde = specifier.slice(2);
    keys.add(withoutTilde);
    const resolved = resolve(root, withoutTilde);
    if (existsSync(resolved)) {
      keys.add(relative(root, resolved).replace(/\\/g, '/'));
    }
    return [...keys];
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const resolved = resolve(dirname(importerFile), specifier);
    if (existsSync(resolved)) {
      keys.add(relative(root, resolved).replace(/\\/g, '/'));
    }
    return [...keys];
  }

  if (!specifier.startsWith('/') && STYLE_EXT.test(specifier)) {
    const resolved = resolve(root, specifier);
    if (existsSync(resolved)) {
      keys.add(relative(root, resolved).replace(/\\/g, '/'));
    }
  }

  return [...keys];
}

/**
 * Scan app source files for CSS side-effect imports and return deduped Wrangler alias keys.
 */
export function discoverCssImportSpecifiers(root: string, appDir = './app'): string[] {
  const normalizedAppDir = appDir.replace(/^\.\//, '');
  const appRoot = join(root, normalizedAppDir);

  if (!existsSync(appRoot)) {
    return [];
  }

  const files = fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: appRoot,
    absolute: true,
    onlyFiles: true,
  });

  const specifiers = new Set<string>();

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf-8');
    for (const specifier of extractCssImportsFromSource(source)) {
      for (const key of expandCssImportSpecifiers(root, filePath, specifier)) {
        specifiers.add(key);
      }
    }
  }

  return [...specifiers].sort();
}

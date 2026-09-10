import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Resolve a specifier from a project's directory (its package.json / node_modules).
 */
export function resolvePackageFrom(fromDir: string, specifier: string): string | undefined {
  const parent = pathToFileURL(join(fromDir, 'package.json')).href;
  try {
    return realpath(fileURLToPath(import.meta.resolve(specifier, parent)));
  } catch {
    try {
      return realpath(createRequire(join(fromDir, 'package.json')).resolve(specifier));
    } catch {
      return undefined;
    }
  }
}

/**
 * Directory of an installed package, starting from `fromDir`.
 */
export function resolvePackageDir(fromDir: string, name: string): string | undefined {
  const file = resolvePackageFrom(fromDir, name);
  if (!file) return undefined;

  const needle = `${sep}node_modules${sep}${name.replaceAll('/', sep)}${sep}`;
  const idx = file.lastIndexOf(needle);
  if (idx !== -1) {
    return realpath(file.slice(0, idx + needle.length - 1));
  }

  let dir = dirname(file);
  while (true) {
    const pkgFile = join(dir, 'package.json');
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { name?: string };
        if (pkg.name === name) return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Force every `preact` / `preact/*` import onto one physical install.
 * Prefer the app's copy; fall back to the plugin's so file: / monorepo links
 * do not load hooks from one Preact and render-to-string from another.
 */
export function preactSingletonAliases(
  projectRoot: string,
  fallbackDir: string
): Record<string, string> {
  const dir = resolvePackageDir(projectRoot, 'preact') ?? resolvePackageDir(fallbackDir, 'preact');
  if (!dir) return {};
  return { preact: dir };
}

export function resolvePreactSpecifier(
  specifier: string,
  projectRoot: string,
  fallbackDir: string
): string | undefined {
  if (specifier === 'preact-render-to-string') {
    return resolvePackageFrom(fallbackDir, specifier) ?? resolvePackageFrom(projectRoot, specifier);
  }
  if (specifier !== 'preact' && !specifier.startsWith('preact/')) return undefined;
  return resolvePackageFrom(projectRoot, specifier) ?? resolvePackageFrom(fallbackDir, specifier);
}

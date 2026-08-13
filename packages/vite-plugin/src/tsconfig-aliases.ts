import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createJiti, type Jiti } from 'jiti';

type Tsconfig = {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
};

function stripJsonc(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readTsconfig(file: string): Tsconfig | undefined {
  try {
    return JSON.parse(stripJsonc(readFileSync(file, 'utf8'))) as Tsconfig;
  } catch {
    return undefined;
  }
}

function findTsconfig(root: string): string | undefined {
  for (const name of ['tsconfig.json', 'tsconfig.app.json']) {
    const file = join(root, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

function loadTsconfig(root: string): { file: string; config: Tsconfig } | undefined {
  const file = findTsconfig(root);
  if (!file) return undefined;

  const config = readTsconfig(file);
  if (!config) return undefined;

  if (config.extends && !config.extends.startsWith('@')) {
    const parentFile = resolve(dirname(file), config.extends);
    const parent = existsSync(parentFile) ? readTsconfig(parentFile) : undefined;
    if (parent) {
      return {
        file,
        config: {
          ...parent,
          ...config,
          compilerOptions: {
            ...parent.compilerOptions,
            ...config.compilerOptions,
            paths: {
              ...parent.compilerOptions?.paths,
              ...config.compilerOptions?.paths,
            },
          },
        },
      };
    }
  }

  return { file, config };
}

/**
 * Convert `compilerOptions.paths` into a prefix alias map for Vite, jiti, and Node hooks.
 *
 * `@/*` becomes `@/` only — a bare `@` alias would steal scoped npm packages.
 */
export function aliasesFromTsconfig(root: string): Record<string, string> {
  const loaded = loadTsconfig(root);
  const paths = loaded?.config.compilerOptions?.paths;
  if (!loaded || !paths) {
    return {};
  }

  const baseUrl = resolve(dirname(loaded.file), loaded.config.compilerOptions?.baseUrl ?? '.');
  const aliases: Record<string, string> = {};

  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets[0];
    if (!target) continue;

    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1);
      const dest = resolve(baseUrl, target.replace(/\/\*$/, ''));
      aliases[prefix] = dest.endsWith('/') ? dest : `${dest}/`;
      const bare = pattern.slice(0, -2);
      if (bare && bare !== '@') {
        aliases[bare] = dest;
      }
    } else {
      aliases[pattern] = resolve(baseUrl, target);
    }
  }

  return aliases;
}

/**
 * Module aliases from the project's tsconfig `paths`.
 */
export function resolveModuleAliases(root: string): Record<string, string> {
  return aliasesFromTsconfig(root);
}

/**
 * jiti loader that honors the project's `tsconfig.json` `paths`.
 */
export function createAppJiti(root: string): Jiti {
  const tsconfigFile = findTsconfig(root);
  return createJiti(root, {
    interopDefault: true,
    tsconfigPaths: tsconfigFile ?? true,
  });
}

/**
 * Resolve a specifier through an alias map. Longest prefix wins.
 */
export function resolveAliasedSpecifier(
  specifier: string,
  aliases: Record<string, string>
): string | undefined {
  const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (specifier === key || specifier.startsWith(key)) {
      const rest = specifier.slice(key.length).replace(/^\//, '');
      return join(aliases[key], rest);
    }
  }
  return undefined;
}

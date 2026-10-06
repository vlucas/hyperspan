#!/usr/bin/env node
/**
 * Compile Node entry packages to JavaScript.
 *
 * Node does not strip TypeScript inside node_modules. Vite loads
 * `@hyperspan/vite-plugin` from node_modules while reading vite.config, then
 * that file imports `@hyperspan/framework`, `@hyperspan/html`, and
 * `@hyperspan/adapter-node`. Those packages must ship JavaScript.
 *
 * Client scripts under `framework/src/client/_hs` stay TypeScript. Vite
 * transforms them, and their package exports are part of the public API.
 */
import { transform } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const packages = {
  html: {
    dir: 'packages/html',
    skip: [/\.test\.ts$/],
  },
  framework: {
    dir: 'packages/framework',
    skip: [/\.test\.ts$/, /^client\/_hs\//],
  },
  'adapter-node': {
    dir: 'packages/adapter-node',
    skip: [/\.test\.ts$/],
  },
  'vite-plugin': {
    dir: 'packages/vite-plugin',
    skip: [/\.test\.ts$/],
  },
};

const requested = process.argv.slice(2);
const selected = requested.length > 0 ? requested : Object.keys(packages);
for (const name of selected) {
  if (!packages[name]) {
    console.error(`Unknown package "${name}". Expected: ${Object.keys(packages).join(', ')}`);
    process.exit(1);
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

function toJsSpecifier(spec) {
  if (/\.(?:json|node|css|wasm|mjs|cjs|js)$/.test(spec)) return spec;
  if (/\.(?:tsx?|mts|cts)$/.test(spec)) return spec.replace(/\.(?:tsx?|mts|cts)$/, '.js');
  return `${spec}.js`;
}

function rewriteSpecifiers(code) {
  const rewritten = code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|(?<![.\w$])import\s+)(['"])(\.\.?\/[^'"]+)\2/g,
    (_full, lead, quote, spec) => `${lead}${quote}${toJsSpecifier(spec)}${quote}`
  );
  return rewritten.replace(
    /new URL\(\s*(['"])(\.[^'"]+)\1/g,
    (full, quote, spec) => {
      if (!/\.(?:tsx?|mts|cts)$/.test(spec) && !spec.includes('.')) return full;
      if (/\.(?:tsx?|mts|cts)$/.test(spec) || !/\.[a-z0-9]+$/i.test(spec)) {
        return `new URL(${quote}${toJsSpecifier(spec)}${quote}`;
      }
      return full;
    }
  );
}

function assertJsImports(code, file) {
  const bare = code.match(/(?:from\s*|import\s*\(\s*|import\s+)(['"])(\.\.?\/[^'"]+)\1/g) ?? [];
  for (const spec of bare) {
    if (!/\.(?:js|mjs|cjs|json|node|css|wasm)['"]$/.test(spec)) {
      throw new Error(`${file} has a relative import without a runtime extension: ${spec}`);
    }
  }
}

async function buildPackage(name) {
  const pkg = packages[name];
  const srcDir = join(root, pkg.dir, 'src');
  const outDir = join(root, pkg.dir, 'dist');
  rmSync(outDir, { recursive: true, force: true });

  const files = walk(srcDir).filter((file) => {
    if (!/\.tsx?$/.test(file)) return false;
    const rel = relative(srcDir, file).replaceAll('\\', '/');
    return !pkg.skip.some((pattern) => pattern.test(rel));
  });

  let written = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const result = await transform(source, {
      loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: file,
    });
    const code = rewriteSpecifiers(result.code);
    if (!code.trim()) continue;
    const rel = relative(srcDir, file).replace(/\.tsx?$/, '.js');
    const outFile = join(outDir, rel);
    assertJsImports(code, rel);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, code);
    written += 1;
  }

  console.log(`[build] ${name}: ${written} files → ${relative(root, outDir)}`);
}

for (const name of selected) {
  await buildPackage(name);
}

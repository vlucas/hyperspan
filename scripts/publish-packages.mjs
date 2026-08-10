#!/usr/bin/env node
/**
 * Publish all public Hyperspan packages.
 *
 * Fetches published versions from the npm registry, diffs against local
 * package.json versions, and only runs `npm publish` for packages that are
 * not already on the registry. Already-published versions are skipped (not
 * failures) — including the 403 "cannot publish over previously published
 * versions" case.
 *
 * Uses inherited stdio so npm can run its normal browser auth flow.
 * Browser auth cannot be reused across packages; an npm Automation token
 * avoids repeated prompts.
 *
 * Usage:
 *   node scripts/publish-packages.mjs
 *   npm run publish:packages
 *   npm run publish:packages -- --dry-run
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');
const dryRun = process.argv.includes('--dry-run');

const SKIP_NAMES = new Set(['example-todo-app', 'hyperspan-app']);

function loadPublishablePackages() {
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const packages = [];
  for (const dir of dirs) {
    const pkgPath = join(packagesDir, dir, 'package.json');
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private) continue;
    if (SKIP_NAMES.has(pkg.name)) continue;
    if (!pkg.publishConfig) continue;

    packages.push({
      dir,
      name: pkg.name,
      version: pkg.version,
      tag: pkg.publishConfig.tag ?? 'latest',
      path: join(packagesDir, dir),
    });
  }
  return packages;
}

function npmJson(args) {
  const result = spawnSync('npm', [...args, '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    return { ok: false, error: out, data: null };
  }
  try {
    return { ok: true, data: out ? JSON.parse(out) : null };
  } catch {
    return { ok: false, error: out, data: null };
  }
}

/**
 * Fetch published versions + dist-tags for a package from the registry.
 * Missing packages (never published) return empty versions.
 */
function fetchRegistryPackage(name) {
  const versionsRes = npmJson(['view', name, 'versions']);
  if (!versionsRes.ok) {
    // E404 / not found → never published
    if (/E404|404 Not Found|not in this registry/i.test(versionsRes.error ?? '')) {
      return { exists: false, versions: [], distTags: {} };
    }
    return {
      exists: false,
      versions: [],
      distTags: {},
      error: versionsRes.error,
    };
  }

  const versions = Array.isArray(versionsRes.data)
    ? versionsRes.data
    : versionsRes.data
      ? [versionsRes.data]
      : [];

  const tagsRes = npmJson(['view', name, 'dist-tags']);
  const distTags =
    tagsRes.ok && tagsRes.data && typeof tagsRes.data === 'object' ? tagsRes.data : {};

  return { exists: true, versions, distTags };
}

function buildPublishPlan(packages) {
  console.log('[publish] Fetching registry versions...\n');

  const plan = [];
  for (const pkg of packages) {
    const registry = fetchRegistryPackage(pkg.name);
    const published = registry.versions.includes(pkg.version);
    const tagVersion = registry.distTags[pkg.tag];

    plan.push({
      ...pkg,
      registryVersions: registry.versions,
      registryTagVersion: tagVersion,
      registryError: registry.error,
      action: published ? 'skip' : 'publish',
    });
  }
  return plan;
}

function printPlan(plan) {
  const rows = plan.map((p) => ({
    package: p.name,
    local: p.version,
    [`tag:${p.tag}`]: p.registryTagVersion ?? (p.registryVersions.length ? '—' : '(new)'),
    action: p.action === 'skip' ? 'skip (exists)' : 'PUBLISH',
  }));
  console.table(rows);

  const toPublish = plan.filter((p) => p.action === 'publish');
  const toSkip = plan.filter((p) => p.action === 'skip');
  console.log(
    `[publish] Plan: ${toPublish.length} to publish, ${toSkip.length} already on registry\n`
  );
  return { toPublish, toSkip };
}

function publishPackage(pkg) {
  const args = ['publish', '--access', 'public'];
  if (pkg.tag) args.push('--tag', pkg.tag);
  if (dryRun) args.push('--dry-run');

  const result = spawnSync('npm', args, {
    cwd: pkg.path,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status === 0) {
    return { status: 'published' };
  }

  // Safety net: treat "already published" races as skips.
  const registry = fetchRegistryPackage(pkg.name);
  if (registry.versions.includes(pkg.version)) {
    return { status: 'skipped' };
  }

  return { status: 'failed', code: result.status ?? 1 };
}

const packages = loadPublishablePackages();

if (packages.length === 0) {
  console.error('No publishable packages found.');
  process.exit(1);
}

console.log(`[publish] ${packages.length} local publishable package(s)${dryRun ? ' (dry-run)' : ''}`);

const plan = buildPublishPlan(packages);
const { toPublish, toSkip } = printPlan(plan);

const lookupErrors = plan.filter((p) => p.registryError);
if (lookupErrors.length > 0) {
  console.warn('[publish] Warning: registry lookup issues:');
  for (const p of lookupErrors) {
    console.warn(`  - ${p.name}: ${p.registryError.split('\n')[0]}`);
  }
  console.warn('');
}

const summary = {
  published: [],
  skipped: toSkip.map((p) => p.name),
  failed: [],
};

if (toPublish.length === 0) {
  console.log('[publish] Nothing to publish — all local versions are already on the registry.');
} else if (!dryRun) {
  console.log(
    '[publish] Each new version may open npm browser auth.\n' +
      '[publish] Tip: an npm Automation token avoids repeated browser prompts.\n'
  );
}

for (const pkg of toPublish) {
  console.log(`→ ${pkg.name}@${pkg.version}${pkg.tag ? ` (tag: ${pkg.tag})` : ''}`);

  // Re-check immediately before publish in case of concurrent publishes.
  const latest = fetchRegistryPackage(pkg.name);
  if (latest.versions.includes(pkg.version)) {
    console.log('  already published (skipped)\n');
    summary.skipped.push(pkg.name);
    continue;
  }

  const result = publishPackage(pkg);

  if (result.status === 'published') {
    console.log(dryRun ? '  ok (dry-run)\n' : '  published\n');
    summary.published.push(pkg.name);
  } else if (result.status === 'skipped') {
    console.log('  already published (skipped)\n');
    summary.skipped.push(pkg.name);
  } else {
    console.log('  FAILED\n');
    summary.failed.push(pkg.name);
  }
}

console.log('[publish] Summary');
console.log(`  published: ${summary.published.length}`);
console.log(`  skipped:   ${summary.skipped.length}`);
console.log(`  failed:    ${summary.failed.length}`);

if (summary.failed.length > 0) {
  console.error(`\nFailed packages:\n  - ${summary.failed.join('\n  - ')}`);
  process.exit(1);
}

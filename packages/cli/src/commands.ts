import { Command } from 'commander';
import degit from 'degit';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'vite';
import packageJson from '../package.json';
import { createAppJiti } from '@hyperspan/vite-plugin/tsconfig-aliases';
import { loadConfig, registerAppLoaders } from './server';

const program = new Command();

program.name('hyperspan').description('CLI for @hyperspan/framework').version(packageJson.version);

program
  .command('create')
  .description('Create a new hyperspan project')
  .argument('<string>', 'project name')
  .action(async (name) => {
    console.log(`[Hyperspan] Creating project ${name}`);

    const emitter = degit('vlucas/hyperspan/packages/starter-template', {
      cache: false,
      force: true,
      verbose: false,
    });

    await emitter.clone(`${name}`);
    console.log(`[Hyperspan] project created in ${name}`);
    console.log(`[Hyperspan] Installing dependencies...`);
    execSync(`cd ${name} && npm install`, { stdio: 'inherit' });
    console.log(`[Hyperspan] Start your server (copy & paste):`);
    console.log(`\n\ncd ${name} && npm run dev`);
  });

program
  .command('dev')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Start the Vite dev server')
  .action(async function (options) {
    process.chdir(options.dir);
    process.env.NODE_ENV = 'development';

    if (!fs.existsSync('app/routes')) {
      console.error('Error: Could not find app/routes - Are you in a Hyperspan project directory?');
      process.exit(1);
    }

    console.log('\n========================================');
    console.log('[Hyperspan] Starting dev server...');

    const configFile = join(process.cwd(), 'vite.config.ts');
    if (!fs.existsSync(configFile)) {
      console.error('Error: vite.config.ts not found. See MIGRATION-v2.md');
      process.exit(1);
    }

    const vite = await createServer({ configFile });
    await vite.listen();
    vite.printUrls();
    console.log('========================================\n');
  });

program
  .command('build')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Build the project for production')
  .action(async function (options) {
    try {
      process.chdir(options.dir);
      process.env.NODE_ENV = 'production';

      const { build } = await import('vite');
      await build({
        configFile: join(process.cwd(), 'vite.config.ts'),
      });

      const config = await loadConfig();
      if (config.deployAdapter?.afterBuild) {
        await config.deployAdapter.afterBuild({
          root: process.cwd(),
          appDir: config.appDir ?? './app',
          outDir: join(process.cwd(), 'dist'),
        });
      }

      console.log('[Hyperspan] Build complete → dist/');
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });

program
  .command('start')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .option('--port <number>', 'port to listen on', '3000')
  .description('Start the production Node server')
  .action(async function (options) {
    process.chdir(options.dir);
    process.env.NODE_ENV = 'production';

    if (!fs.existsSync('app/routes')) {
      console.error('Error: Could not find app/routes - Are you in a Hyperspan project directory?');
      process.exit(1);
    }

    console.log('[Hyperspan] Starting production server...');

    const root = process.cwd();
    const serverEntry = join(root, 'dist/server.ts');
    if (!fs.existsSync(serverEntry)) {
      console.error('[Hyperspan] dist/server.ts not found. Run hyperspan build first.');
      process.exit(1);
    }

    registerAppLoaders(root);
    const jiti = createAppJiti(root);
    const mod = (await jiti.import(serverEntry)) as {
      start?: (options: { port?: number }) => Promise<unknown>;
    };
    if (typeof mod.start !== 'function') {
      console.error(
        '[Hyperspan] dist/server.ts has no start() — use Wrangler for Cloudflare Workers.'
      );
      process.exit(1);
    }
    await mod.start({ port: Number(options.port) });
  });

program
  .command('build:ssg')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Build the project for SSG')
  .action(async () => {
    console.error('Error: SSG build not implemented yet... :(');
    process.exit(1);
  });

program.parse();

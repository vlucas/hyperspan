#!/usr/bin/env bun

import { Command } from 'commander';
import degit from 'degit';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import packageJson from '../package.json';
import { startServer } from './server';
import { createContext } from '@hyperspan/framework';
import { join } from 'node:path';

const program = new Command();

program.name('hyperspan').description('CLI for @hyperspan/framework').version(packageJson.version);

/**
 * Create a new hyperspan project
 */
program
  .command('create')
  .description('Create a new hyperspan project')
  .argument('<string>', 'project name')
  .action(async (name) => {
    console.log(`Creating project ${name}`);

    const emitter = degit('vlucas/hyperspan/packages/starter-template', {
      cache: true,
      force: true,
      verbose: false,
    });

    await emitter.clone(`${name}`);
    console.log(`Hyperspan project created in ${name}`);
    console.log(`Installing dependencies...`);
    execSync(`cd ${name} && bun install`, { stdio: 'inherit' });
    console.log(`Dependencies installed`);
    console.log(`Running dev server...`);
    execSync(`cd ${name} && bun dev`, { stdio: 'inherit' });
  });

/**
 * Start the server
 */
program
  .command('start')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Start the server')
  .action(async (options) => {
    // Ensure we are in a hyperspan project
    const serverFile = `${options.dir}/app/routes`;

    if (!fs.existsSync(serverFile)) {
      console.error(
        'Error: Could not find app/routes - Are you in a Hyperspan project directory?'
      );
      process.exit(1);
    }

    console.log('\n========================================');
    console.log('[Hyperspan] Starting...');

    const server = await startServer({ development: process.env.NODE_ENV !== 'production' });

    const routes: Record<string, (request: Request) => Promise<Response>> = {};
    for (const route of server._routes) {
      routes[route._path()] = (request: Request) => route.fetch(request);
    }

    const httpServer = Bun.serve({
      routes,
      fetch: async (request: Request) => {
        // Serve static files from the public directory
        const url = new URL(request.url);
        if (url.pathname.startsWith('/_hs/')) {
          return new Response(Bun.file(join('./', server._config.publicDir, url.pathname)));
        }

        // Other static file from the public directory
        const file = Bun.file(join('./', server._config.publicDir, url.pathname))
        const fileExists = await file.exists()
        if (fileExists) {
          return new Response(file);
        }

        // Not found
        return createContext(request).res.notFound();
      },
    });

    console.log(`[Hyperspan] Server started on http://localhost:${httpServer.port} (Press Ctrl+C to stop)`);
    console.log('========================================\n');
  });

program
  .command('build:ssg')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Build the project for SSG')
  .action(async (options) => {
    // Ensure we are in a hyperspan project
    const serverFile = `${options.dir}/app/server.ts`;

    if (!fs.existsSync(serverFile)) {
      console.error(
        'Error: Could not find app/server.ts - Are you in a Hyperspan project directory?'
      );
      process.exit(1);
    }

    const server = await import(serverFile);

    console.log(server);
  });

program.parse();

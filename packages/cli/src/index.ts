#!/usr/bin/env bun

import { Command } from 'commander';
import degit from 'degit';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import packageJson from '../package.json';
import { createHyperspanServer } from './server';
import { startBunServer } from './runtimes/bun';

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
    execSync(`cd ${name} && bun install`, { stdio: 'pipe' });
    console.log(`Dependencies installed!`);
    console.log(`Running dev server...`);
    execSync(`cd ${name} && bun dev`, { stdio: 'pipe' });
  });

/**
 * Start the server
 */
program
  .command('start')
  .alias('dev')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Start the server')
  .action(async function (options) {

    const IS_DEV_MODE = process.argv.includes('dev');

    // Developer mode (extra logging, etc.)
    if (IS_DEV_MODE) {
      console.log('[Hyperspan] Developer mode enabled 🛠️');
      process.env.NODE_ENV = 'development';
    }

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

    const server = await createHyperspanServer({ development: IS_DEV_MODE });
    const httpServer = startBunServer(server);

    console.log(`[Hyperspan] Server started on http://localhost:${httpServer.port} (Press Ctrl+C to stop)`);
    console.log('========================================\n');

    return httpServer;
  });

program
  .command('build:ssg')
  .option('--dir <path>', 'directory of your hyperspan project', './')
  .description('Build the project for SSG')
  .action(async (options) => {
    console.error('Error: SSG build not implemented yet... :(');
    process.exit(1);

  });

program.parse();

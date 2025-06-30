import { Command } from 'commander';
import degit from 'degit';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import packageJson from '../package.json';

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
 * Build the project for SSG
 */
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

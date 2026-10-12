#!/usr/bin/env node
import { register } from 'tsx/esm/api';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Allow Node to import TypeScript sources from @hyperspan/* packages
register();

const dir = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(join(dir, '..'), {
  interopDefault: true,
  extensions: ['.ts', '.tsx', '.js', '.mjs'],
});
await jiti.import('./src/commands.ts');

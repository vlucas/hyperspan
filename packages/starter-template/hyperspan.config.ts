import { preactPlugin } from '@hyperspan/plugin-preact';
import { createConfig } from '@hyperspan/framework';

/**
 * Hyperspan config
 * This file should be imported FIRST in your app/server.ts file so that plugins are loaded BEFORE other file imports.
 */
export default createConfig({
  appDir: './app',
  publicDir: './public',
  plugins: [preactPlugin()],
});

import { createConfig } from '@hyperspan/framework';
import { preactPlugin } from '@hyperspan/plugin-preact';

/**
 * Hyperspan config
 * This file should be imported FIRST in your app/server.ts file so that plugins are loaded BEFORE other file imports.
 */
export default createConfig({
  appDir: './app',
  staticFileRoot: './public',
  islandPlugins: [preactPlugin()],
});

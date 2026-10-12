import { createConfig } from '@hyperspan/framework';
import { preactPlugin } from '@hyperspan/plugin-preact';

/**
 * Hyperspan config
 * @see https://www.hyperspan.dev/docs/config
 */
export default createConfig({
  appDir: './app',
  publicDir: './public',
  plugins: [preactPlugin()],
});

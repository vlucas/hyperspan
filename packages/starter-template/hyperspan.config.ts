import { preactPlugin } from '@hyperspan/plugin-preact';
import { sveltePlugin } from '@hyperspan/plugin-svelte';
import { vuePlugin } from '@hyperspan/plugin-vue';
import { createConfig } from '@hyperspan/framework';

/**
 * Hyperspan config
 * @see https://www.hyperspan.dev/docs/config
 */
export default createConfig({
  appDir: './app',
  publicDir: './public',
  plugins: [preactPlugin(), sveltePlugin(), vuePlugin()],
});

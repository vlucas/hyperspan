import { createConfig } from '@hyperspan/framework';
import { preactPlugin } from '@hyperspan/plugin-preact';
import { initDb } from './src/lib/db';

export default createConfig({
  deployTarget: 'cloudflare',
  beforeServerCreate({ env }: { env: Env }) {
    initDb(env.TODO_KV);
  },
  appDir: './app',
  publicDir: './public',
  plugins: [preactPlugin()],
});

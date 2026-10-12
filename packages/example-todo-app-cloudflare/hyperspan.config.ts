import { createConfig } from '@hyperspan/framework';
import { cloudflareAdapter } from '@hyperspan/adapter-cloudflare';
import { preactPlugin } from '@hyperspan/plugin-preact';
import { initDb } from './src/lib/db';

export default createConfig({
  deployAdapter: cloudflareAdapter(),
  beforeServerCreate({ env }: { env: Env }) {
    initDb(env.TODO_KV);
  },
  appDir: './app',
  publicDir: './public',
  plugins: [preactPlugin()],
});

import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { hyperspan } from '@hyperspan/vite-plugin';

export default defineConfig({
  plugins: [tailwindcss(), ...hyperspan()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

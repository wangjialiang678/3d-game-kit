import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Shared engine lives in ../../packages/engine/src and is imported as '@engine'.
export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 5176, fs: { strict: false } },
});

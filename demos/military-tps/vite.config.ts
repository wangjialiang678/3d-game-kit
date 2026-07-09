import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { contentSavePlugin } from '@kit/core/vite-content-save.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Shared engine lives in ../../packages/engine/src and is imported as '@engine'.
export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)),
      '@kit/core': fileURLToPath(new URL('../../packages/kit', import.meta.url)),
    },
  },
  plugins: [contentSavePlugin({
    root: ROOT,
    files: { arena: 'public/content/arena.json' },
    validate: (payload) => {
      const issues = [];
      if (!payload.arena?.covers) issues.push({ where: 'payload.arena', message: '缺少 arena.covers' });
      if (!payload.arena?.entities) issues.push({ where: 'payload.arena', message: '缺少 arena.entities' });
      return issues;
    },
  })],
  server: { host: '127.0.0.1', port: 5176, fs: { strict: false } },
});

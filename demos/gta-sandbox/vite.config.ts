import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { contentSavePlugin } from '@kit/core/vite-content-save.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)),
      '@kit/core': fileURLToPath(new URL('../../packages/kit', import.meta.url)),
    },
  },
  plugins: [contentSavePlugin({
    root: ROOT,
    files: {
      scene: 'public/content/scene.json',
      missionsPack: 'public/content/missions.json',
    },
    validate: (payload) => {
      const issues = [];
      if (!payload.scene?.town) issues.push({ where: 'payload.scene', message: '缺少 scene.town' });
      if (!payload.missionsPack?.missions) issues.push({ where: 'payload.missionsPack', message: '缺少 missionsPack.missions' });
      return issues;
    },
  })],
  server: { host: '127.0.0.1', port: 5177, fs: { strict: false } },
});

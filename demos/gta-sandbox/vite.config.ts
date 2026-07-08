import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** P4：可视化编辑器的保存通道（仅 dev）。POST /__kit/save-content → 写回 public/content/*.json */
function contentSavePlugin(): Plugin {
  return {
    name: 'kit-content-save',
    configureServer(server) {
      server.middlewares.use('/__kit/save-content', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { scene, missionsPack } = JSON.parse(body);
            if (!scene?.town || !missionsPack?.missions) throw new Error('缺少 scene/missionsPack');
            writeFileSync(join(ROOT, 'public/content/scene.json'), JSON.stringify(scene, null, 2) + '\n');
            writeFileSync(join(ROOT, 'public/content/missions.json'), JSON.stringify(missionsPack, null, 2) + '\n');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)),
    },
  },
  plugins: [contentSavePlugin()],
  server: { host: '127.0.0.1', port: 5177, fs: { strict: false } },
});

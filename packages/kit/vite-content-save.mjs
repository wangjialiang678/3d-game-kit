import { writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('error', reject);
    req.on('end', () => resolve(body));
  });
}

/** Dev-only Vite middleware: POST JSON payload keys to configured content files. */
export function contentSavePlugin({ root, files, validate } = {}) {
  if (!root) throw new Error('contentSavePlugin requires root');
  if (!files || !Object.keys(files).length) throw new Error('contentSavePlugin requires files');
  return {
    name: 'kit-content-save',
    configureServer(server) {
      server.middlewares.use('/__kit/save-content', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        try {
          const payload = JSON.parse(await readBody(req));
          const issues = validate?.(payload) ?? [];
          if (issues.length) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, issues }));
            return;
          }
          for (const [key, rel] of Object.entries(files)) {
            if (!(key in payload)) throw new Error(`缺少 payload.${key}`);
            const path = isAbsolute(rel) ? rel : join(root, rel);
            writeFileSync(path, JSON.stringify(payload[key], null, 2) + '\n');
          }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
    },
  };
}

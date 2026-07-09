#!/usr/bin/env node
import { build } from 'esbuild';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEMO = join(ROOT, 'demos/gta-sandbox');
const OUT = join(DEMO, 'dist-headless/headless.mjs');

function aliasPlugin() {
  return {
    name: 'gta-headless-alias',
    setup(api) {
      api.onResolve({ filter: /^@engine$/ }, () => ({ path: join(ROOT, 'packages/engine/src/index.ts') }));
      api.onResolve({ filter: /^@engine\/(.+)$/ }, (args) => ({ path: join(ROOT, 'packages/engine/src', `${args.path.slice('@engine/'.length)}.ts`) }));
      api.onResolve({ filter: /^@kit\/core$/ }, () => ({ path: join(ROOT, 'packages/kit/index.mjs') }));
      api.onResolve({ filter: /^@kit\/core\/(.+)$/ }, (args) => {
        const sub = args.path.slice('@kit/core/'.length);
        return { path: join(ROOT, 'packages/kit', extname(sub) ? sub : `${sub}.ts`) };
      });
    },
  };
}

export async function buildHeadless() {
  await build({
    entryPoints: [join(DEMO, 'src/headless.ts')],
    outfile: OUT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: false,
    external: ['three', '@dimforge/rapier3d-compat'],
    plugins: [aliasPlugin()],
    logLevel: 'silent',
  });
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await buildHeadless();
  console.log(`built ${out}`);
}

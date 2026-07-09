#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPlaytest } from '@kit/core/playtest-lib.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://127.0.0.1:5176';

await runPlaytest({
  url,
  cwd: ROOT,
  port: 5176,
  timeoutMs: 240_000,
  screenshotPath: join(ROOT, 'playtest-fail.png'),
  reportTitle: 'MILITARY PLAYTEST 报告',
  passText: 'PASS：机器人全歼敌军并触发胜利规则',
  failText: 'FAIL：military 试玩未通过',
});

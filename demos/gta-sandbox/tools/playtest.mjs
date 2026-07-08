#!/usr/bin/env node
/**
 * playtest.mjs — 无头试玩验证（P3：一条命令让机器人像玩家一样打穿全部任务）。
 * 用 puppeteer-core 驱动系统 Chrome 打开 ?autotest，读取 window.__autotest 结果。
 * dev server 没开会自动拉起（跑完自动关掉）。
 *
 *   node tools/playtest.mjs [--headed] [--url http://127.0.0.1:5177]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const URL_BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://127.0.0.1:5177';
const HEADED = process.argv.includes('--headed');
const TIMEOUT_MS = 480_000;

const serverAlive = async () => {
  try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(1500) }); return r.ok; }
  catch { return false; }
};

let viteProc = null;
if (!(await serverAlive())) {
  console.log('dev server 未运行，自动拉起 vite…');
  viteProc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', detached: false,
  });
  const t0 = Date.now();
  while (!(await serverAlive())) {
    if (Date.now() - t0 > 20_000) { console.error('vite 启动超时'); process.exit(1); }
    await new Promise((r) => setTimeout(r, 400));
  }
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];
const { existsSync } = await import('node:fs');
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) { console.error('找不到 Chrome，可用 --headed 并设置 PUPPETEER_EXECUTABLE_PATH'); process.exit(1); }

console.log(`启动 ${HEADED ? '有头' : '无头'} Chrome，试玩 ${URL_BASE}/?autotest …`);
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || chrome,
  headless: !HEADED,
  protocolTimeout: 600_000,   // waitForFunction 长轮询会吃满单次 CDP 调用时长，默认 180s 不够
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800'],
});

let exitCode = 1;
let page;
try {
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${URL_BASE}/?autotest`, { waitUntil: 'domcontentloaded' });

  const result = await page.waitForFunction('window.__autotest && window.__autotest.done', { timeout: TIMEOUT_MS, polling: 1000 })
    .then(() => page.evaluate('window.__autotest'));

  console.log('\n===== PLAYTEST 报告 =====');
  for (const s of result.steps) {
    console.log(`${s.pass ? '✅' : '❌'} ${s.name}  ${(s.ms / 1000).toFixed(1)}s${s.detail ? '  ' + s.detail : ''}`);
  }
  console.log(result.pass ? '\n🎉 PASS：机器人以真实输入打穿了全部任务' : '\n💥 FAIL：存在失败步骤');
  if (!result.pass) {
    const tele = await page.evaluate('window.__tele || []');
    if (tele.length) {
      console.log('\n--- 任务③黑匣子（每行1秒）---');
      for (const s of tele.slice(-40)) console.log(JSON.stringify(s));
    }
    const shot = join(ROOT, 'playtest-fail.png');
    await page.screenshot({ path: shot });
    console.log(`失败现场截图：${shot}`);
  }
  exitCode = result.pass ? 0 : 1;
} catch (e) {
  console.error('playtest 异常：', String(e).slice(0, 300));
  try {
    const partial = await page?.evaluate('window.__autotest || null');
    if (partial?.steps) for (const s of partial.steps) console.error(`  ${s.pass ? '✅' : '❌'} ${s.name} ${(s.ms / 1000).toFixed(1)}s`);
    const hud = await page?.evaluate(`document.querySelector('div[style*="monospace"]')?.textContent || ''`);
    if (hud) console.error('  HUD:', hud.split('\n').pop());
    const tele = await page?.evaluate('window.__tele || []');
    if (tele?.length) {
      console.error('  --- 任务③黑匣子（每行1秒）---');
      for (const s of tele.slice(-40)) console.error('  ' + JSON.stringify(s));
    }
    const shot = join(ROOT, 'playtest-fail.png');
    await page?.screenshot({ path: shot });
    console.error(`  失败现场截图：${shot}`);
  } catch { /* 页面已不可用 */ }
} finally {
  await browser.close();
  if (viteProc) viteProc.kill();
}
process.exit(exitCode);

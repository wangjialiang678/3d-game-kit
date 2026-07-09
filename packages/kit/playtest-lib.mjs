import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

async function serverAlive(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer({ url, cwd, port }) {
  if (await serverAlive(url)) return null;
  console.log('dev server 未运行，自动拉起 vite…');
  const proc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd,
    stdio: 'ignore',
    detached: false,
  });
  const t0 = Date.now();
  while (!(await serverAlive(url))) {
    if (Date.now() - t0 > 20_000) throw new Error('vite 启动超时');
    await new Promise((r) => setTimeout(r, 400));
  }
  return proc;
}

export async function runPlaytest(options) {
  const {
    url,
    cwd,
    port,
    timeoutMs = 480_000,
    headed = process.argv.includes('--headed'),
    resultExpr = 'window.__autotest',
    path = '/?autotest',
    screenshotPath,
    reportTitle = 'PLAYTEST 报告',
    passText = 'PASS：机器人以真实输入打穿了目标流程',
    failText = 'FAIL：存在失败步骤',
  } = options;

  const viteProc = await ensureServer({ url, cwd, port });
  const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('找不到 Chrome，可用 --headed 并设置 PUPPETEER_EXECUTABLE_PATH');

  const puppeteer = await import('puppeteer-core');
  console.log(`启动 ${headed ? '有头' : '无头'} Chrome，试玩 ${url}${path} …`);
  const browser = await puppeteer.default.launch({
    executablePath: chrome,
    headless: !headed,
    protocolTimeout: Math.max(600_000, timeoutMs + 30_000),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800'],
  });

  let exitCode = 1;
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
    const result = await page.waitForFunction(`${resultExpr} && ${resultExpr}.done`, { timeout: timeoutMs, polling: 1000 })
      .then(() => page.evaluate(resultExpr));

    console.log(`\n===== ${reportTitle} =====`);
    for (const s of result.steps ?? []) {
      console.log(`${s.pass ? '✅' : '❌'} ${s.name}  ${(s.ms / 1000).toFixed(1)}s${s.detail ? '  ' + s.detail : ''}`);
    }
    console.log(result.pass ? `\n🎉 ${passText}` : `\n💥 ${failText}`);
    if (!result.pass && screenshotPath) {
      await page.screenshot({ path: screenshotPath });
      console.log(`失败现场截图：${screenshotPath}`);
    }
    exitCode = result.pass ? 0 : 1;
  } catch (e) {
    console.error('playtest 异常：', String(e).slice(0, 300));
    try {
      const partial = await page?.evaluate(resultExpr + ' || null');
      if (partial?.steps) for (const s of partial.steps) console.error(`  ${s.pass ? '✅' : '❌'} ${s.name} ${(s.ms / 1000).toFixed(1)}s`);
      if (screenshotPath) {
        await page?.screenshot({ path: screenshotPath });
        console.error(`  失败现场截图：${screenshotPath}`);
      }
    } catch {
      // ignore page teardown errors
    }
  } finally {
    await browser.close();
    if (viteProc) viteProc.kill();
  }
  process.exit(exitCode);
}

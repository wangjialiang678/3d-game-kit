export function harness(name = 'simulation') {
  const t0 = performance.now();
  let failed = 0;
  return {
    section(title) {
      console.log(`${title.startsWith('\n') ? '' : '\n'}===== ${title.replace(/^\n/, '')} =====`);
    },
    check(label, ok, detail = '') {
      console.log(`${ok ? '✅' : '❌'} ${label}${detail ? '  ' + detail : ''}`);
      if (!ok) failed++;
    },
    issues(label, issues) {
      for (const issue of issues) console.log(`  ⛔ [${issue.where}] ${issue.message}`);
      this.check(label, issues.length === 0);
    },
    finish(success = 'L0+L1 全部通过', failure = '项失败') {
      const ms = (performance.now() - t0).toFixed(1);
      console.log(`\n${failed === 0 ? '🎉 ' + success : `💥 ${failed} ${failure}`}（总耗时 ${ms}ms）`);
      process.exit(failed === 0 ? 0 : 1);
    },
    get failed() { return failed; },
    get name() { return name; },
  };
}

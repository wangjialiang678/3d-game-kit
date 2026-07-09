export function fetchJsonReader() {
  return async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法加载 ${url}: HTTP ${res.status}`);
    return res.json();
  };
}

export function nodeJsonReader(baseDir = process.cwd()) {
  return async (file) => {
    const runtimeImport = new Function('specifier', 'return import(specifier)');
    const [{ readFile }, { isAbsolute, join }] = await Promise.all([
      runtimeImport('node:fs/promises'),
      runtimeImport('node:path'),
    ]);
    const path = isAbsolute(file) ? file : join(baseDir, file);
    return JSON.parse(await readFile(path, 'utf8'));
  };
}

export class ContentValidationError extends Error {
  constructor(issues) {
    super(`内容包校验失败（${issues.length} 处）`);
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}

export async function loadPack({ files, reader = fetchJsonReader(), build = (raw) => raw, validators = [] }) {
  const entries = await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await reader(path, key)]));
  const raw = Object.fromEntries(entries);
  const content = build(raw);
  const issues = validators.flatMap((v) => v(content) ?? []);
  if (issues.length) throw new ContentValidationError(issues);
  return content;
}

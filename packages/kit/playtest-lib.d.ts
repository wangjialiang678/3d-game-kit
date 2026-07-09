export function runPlaytest(options: {
  url: string;
  cwd: string;
  port: number;
  timeoutMs?: number;
  headed?: boolean;
  resultExpr?: string;
  path?: string;
  screenshotPath?: string;
  reportTitle?: string;
  passText?: string;
  failText?: string;
}): Promise<never>;

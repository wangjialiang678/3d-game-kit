#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { buildHeadless } from './build-headless.mjs';

const out = await buildHeadless();
const mod = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
const report = await mod.runHeadlessSim();

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);

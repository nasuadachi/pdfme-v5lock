#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const template = process.env.XCTRACE_TEMPLATE || 'Allocations';
const mode = process.env.XCTRACE_MODE || (['Activity Monitor', 'System Trace'].includes(template) ? 'all-processes' : 'attach');
const iterations = process.env.ITERATIONS || '5';
const displayMs = process.env.DISPLAY_MS || '2500';
const disposeMs = process.env.DISPOSE_MS || '3000';
const outputDir = process.env.XCTRACE_OUTPUT_DIR || path.join(repoRoot, 'tmp/xctrace');
const traceWarmupMs = Number(process.env.XCTRACE_WARMUP_MS || 3000);
const attachPattern = new RegExp(
  process.env.XCTRACE_ATTACH_PATTERN || 'com\\.apple\\.WebKit\\.WebContent|Safari\\.app',
);
const traceTimeLimitMs =
  Number(process.env.XCTRACE_TIME_LIMIT_MS) ||
  Number(iterations) * (Number(displayMs) + Number(disposeMs)) + traceWarmupMs + 10000;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const templateSlug = template.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outputPath =
  process.env.XCTRACE_OUTPUT ||
  path.join(outputDir, `safari-pdf-cycle-${templateSlug}-${timestamp}.trace`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const targetCommand = [
  process.execPath,
  path.join(repoRoot, 'scripts/safari-pdf-viewer-cycle.mjs'),
];

console.log(`Recording ${template} trace to ${outputPath}`);
console.log(`Safari cycle: ITERATIONS=${iterations} DISPLAY_MS=${displayMs} DISPOSE_MS=${disposeMs}`);
console.log(`xctrace time limit: ${traceTimeLimitMs}ms`);
console.log(`xctrace mode: ${mode}`);

const waitForExit = (child, name) =>
  new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${name} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${name} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readProcessRows = async () => {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,rss=,comm=']);
  return stdout
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return undefined;
      return { pid: Number(match[1]), rssBytes: Number(match[2]) * 1024, comm: match[3] };
    })
    .filter(Boolean);
};

const findAttachPid = async () => {
  const rows = (await readProcessRows()).filter((row) => attachPattern.test(row.comm));
  rows.sort((a, b) => b.rssBytes - a.rssBytes);
  return rows[0];
};

try {
  const safariCycle = spawn(targetCommand[0], [targetCommand[1]], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ITERATIONS: iterations,
      DISPLAY_MS: displayMs,
      DISPOSE_MS: disposeMs,
      WAIT_BEFORE_CYCLE_MS: String(traceWarmupMs),
    },
  });

  await delay(Math.max(1000, Math.min(traceWarmupMs - 500, traceWarmupMs)));

  let targetArgs;
  if (mode === 'all-processes') {
    targetArgs = ['--all-processes'];
  } else {
    const attachTarget = await findAttachPid();
    if (!attachTarget) {
      throw new Error(`No Safari/WebKit process matched ${attachPattern}`);
    }
    console.log(`Attaching xctrace to PID ${attachTarget.pid}: ${attachTarget.comm}`);
    targetArgs = ['--attach', String(attachTarget.pid)];
  }

  const trace = spawn(
    'xcrun',
    [
      'xctrace',
      'record',
      '--template',
      template,
      ...targetArgs,
      '--output',
      outputPath,
      '--time-limit',
      `${traceTimeLimitMs}ms`,
      '--no-prompt',
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  );

  await waitForExit(safariCycle, 'Safari cycle');
  let traceFailed = false;
  try {
    await waitForExit(trace, 'xctrace');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('xctrace may still have saved a partial trace; check the output path.');
    traceFailed = true;
    process.exitCode = 1;
  }
  if (!traceFailed) {
    console.log(`Trace saved: ${outputPath}`);
    console.log(`Inspect table of contents with: xcrun xctrace export --input ${outputPath} --toc`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { remote } from 'webdriverio';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const pdfPath = process.env.PDF_PATH || path.join(repoRoot, 'playground/test-3page.pdf');
const iterations = Number(process.env.ITERATIONS || 5);
const displayMs = Number(process.env.DISPLAY_MS || 2500);
const disposeMs = Number(process.env.DISPOSE_MS || 3000);
const safaridriverPort = Number(process.env.SAFARIDRIVER_PORT || 4444);
const waitBeforeCycleMs = Number(process.env.WAIT_BEFORE_CYCLE_MS || 0);

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      body { margin: 0; font-family: sans-serif; }
      #status { position: fixed; z-index: 1; left: 8px; top: 8px; background: #fff; }
      #viewer { width: 100vw; height: 100vh; border: 0; display: block; }
    </style>
  </head>
  <body>
    <div id="status">idle</div>
    <div id="host"></div>
    <script>
      const activeUrls = new Set();
      const stats = { created: 0, revoked: 0, active: 0, loads: 0, disposes: 0 };
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);

      URL.createObjectURL = (value) => {
        const url = originalCreateObjectURL(value);
        activeUrls.add(url);
        stats.created += 1;
        stats.active = activeUrls.size;
        return url;
      };

      URL.revokeObjectURL = (url) => {
        if (activeUrls.delete(url)) {
          stats.revoked += 1;
          stats.active = activeUrls.size;
        }
        return originalRevokeObjectURL(url);
      };

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      window.showPdf = async (iteration, displayMs) => {
        document.getElementById('status').textContent = 'show ' + iteration;
        const response = await fetch('/test-3page.pdf', { cache: 'no-store' });
        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const iframe = document.createElement('iframe');
        iframe.id = 'viewer';
        iframe.src = url;
        iframe.dataset.url = url;
        document.getElementById('host').replaceChildren(iframe);
        stats.loads += 1;
        await Promise.race([
          new Promise((resolve) => { iframe.onload = resolve; }),
          sleep(displayMs),
        ]);
        await sleep(displayMs);
      };

      window.disposePdf = async (iteration, disposeMs) => {
        document.getElementById('status').textContent = 'dispose ' + iteration;
        const host = document.getElementById('host');
        const iframe = document.getElementById('viewer');
        if (iframe) {
          const url = iframe.dataset.url;
          iframe.removeAttribute('src');
          iframe.src = 'about:blank';
          host.replaceChildren();
          if (url) URL.revokeObjectURL(url);
        }
        stats.disposes += 1;
        await sleep(disposeMs);
      };

      window.getCycleState = () => ({
        ...stats,
        status: document.getElementById('status').textContent,
        iframeCount: document.querySelectorAll('iframe').length,
        usedJSHeapSize: performance.memory && performance.memory.usedJSHeapSize,
      });
    </script>
  </body>
</html>`;

const mb = (bytes) => bytes / 1024 / 1024;

const serve = () =>
  new Promise((resolve, reject) => {
    const pdfBytes = fs.readFileSync(pdfPath);
    const server = http.createServer((req, res) => {
      if (req.url === '/test-3page.pdf') {
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': pdfBytes.byteLength,
          'cache-control': 'no-store',
        });
        res.end(pdfBytes);
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(html);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });

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

const isSafariMemoryProcess = (row) => {
  const comm = row.comm;
  return (
    comm.includes('/Safari.app/') ||
    comm.includes('/com.apple.Safari') ||
    comm.includes('/SafariPlatformSupport') ||
    comm.includes('/SafariFoundation') ||
    comm.includes('/WebKit.framework/') ||
    comm.includes('/com.apple.WebKit.')
  );
};

const getSafariRss = async () => {
  const rows = (await readProcessRows()).filter(isSafariMemoryProcess);
  return {
    rssBytes: rows.reduce((sum, row) => sum + row.rssBytes, 0),
    processCount: rows.length,
  };
};

const startSafaridriver = async () => {
  const child = spawn('safaridriver', ['-p', String(safaridriverPort)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`safaridriver exited early: ${stderr.trim()}`);
    }

    try {
      await execFileAsync('curl', ['-fsS', `http://127.0.0.1:${safaridriverPort}/status`]);
      return child;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  child.kill();
  throw new Error(
    'safaridriver did not become ready. Ensure Safari Develop > Allow Remote Automation is enabled.',
  );
};

const sample = async (browser, label, firstRssBytes = 0) => {
  const [rss, state] = await Promise.all([
    getSafariRss(),
    browser.execute(() => window.getCycleState()),
  ]);

  return {
    label,
    rssBytes: rss.rssBytes,
    rssDeltaBytes: rss.rssBytes - firstRssBytes,
    processCount: rss.processCount,
    state,
  };
};

const printSample = (item) => {
  console.log(
    [
      item.label.padEnd(16),
      `rss=${mb(item.rssBytes).toFixed(1)}MB`,
      `delta=${mb(item.rssDeltaBytes).toFixed(1)}MB`,
      `processes=${item.processCount}`,
      `created=${item.state.created}`,
      `revoked=${item.state.revoked}`,
      `active=${item.state.active}`,
      `iframes=${item.state.iframeCount}`,
      `status=${item.state.status}`,
    ].join(' '),
  );
};

if (!fs.existsSync(pdfPath)) {
  throw new Error(`PDF not found: ${pdfPath}`);
}

const server = await serve();
const safaridriver = await startSafaridriver();
let browser;

try {
  try {
    browser = await remote({
      logLevel: 'error',
      protocol: 'http',
      hostname: '127.0.0.1',
      port: safaridriverPort,
      path: '/',
      capabilities: {
        browserName: 'safari',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Allow remote automation')) {
      throw new Error(
        [
          'Safari remote automation is disabled.',
          'Enable Safari Settings > Advanced > Show features for web developers,',
          'then Develop > Allow Remote Automation, or run `safaridriver --enable` with admin privileges.',
        ].join(' '),
      );
    }
    throw error;
  }

  await browser.url(server.url);
  await browser.waitUntil(async () => browser.execute(() => typeof window.showPdf === 'function'), {
    timeout: 5000,
    timeoutMsg: 'Safari harness page did not initialize',
  });

  const before = await sample(browser, 'before');
  const firstRssBytes = before.rssBytes;
  before.rssDeltaBytes = 0;
  printSample(before);
  if (waitBeforeCycleMs > 0) {
    console.log(`waiting-before-cycle ${waitBeforeCycleMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitBeforeCycleMs));
  }

  for (let idx = 1; idx <= iterations; idx += 1) {
    await browser.executeAsync(
      (iteration, ms, done) => {
        window.showPdf(iteration, ms).then(done, (error) => done(String(error)));
      },
      idx,
      displayMs,
    );
    printSample(await sample(browser, `after-show-${idx}`, firstRssBytes));

    await browser.executeAsync(
      (iteration, ms, done) => {
        window.disposePdf(iteration, ms).then(done, (error) => done(String(error)));
      },
      idx,
      disposeMs,
    );
    printSample(await sample(browser, `after-dispose-${idx}`, firstRssBytes));
  }
} finally {
  if (browser) {
    await browser.deleteSession().catch(() => {});
  }
  safaridriver.kill();
  await server.close();
}

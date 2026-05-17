# Codex WebKit Memory Leak Report

Created: 2026-05-17
Branch: `nasu/v5.5`

This file is intentionally placed at the repository root so future Codex runs
notice it before continuing Safari/WebKit memory work.

## Current Finding

The `v5lock.1`/`v5lock.2` pdf-lib disposal work does not materially improve the
crash pattern seen in the real Safari/iPadOS app when generated PDFs are opened
repeatedly through WebKit's PDF viewer path.

The strongest signal is that `URL.revokeObjectURL()` is being called and active
object URL count returns to zero, but WebKit RSS still grows when the PDF is
shown through the blob/iframe viewer path.

## Test Targets

Main worktree:

```text
/Users/keitaro/git/pdfme-v5lock
baseline commit: 712c7414 test(pdf-lib): cover svg rendering fixtures
latest committed mitigation: 4eef07f6 Mitigate WebKit PDF memory retention
label: current-v5lock2 / nasu-v5.5
```

Comparison worktree:

```text
/Users/keitaro/git/pdfme-v5lock-before-v5lock1
commit: d6024a04 fix: release PDF resources after conversion
label: before-v5lock1
```

Comparison worktree was created with:

```sh
git worktree add /Users/keitaro/git/pdfme-v5lock-before-v5lock1 d6024a04
```

## Harness

Temporary harness used for this investigation:

```text
/Users/keitaro/tmp/pdfme-worktree-webkit-bench.js
```

Temporary browser bundles used by the harness:

```text
/Users/keitaro/tmp/pdfme-pdf-lib-before-v5lock1.mjs
/Users/keitaro/tmp/pdfme-pdf-lib-current-v5lock2.mjs
```

Latest result files:

```text
/Users/keitaro/tmp/pdfme-webkit-bench-results/latest-summary.csv
/Users/keitaro/tmp/pdfme-webkit-bench-results/latest.json
```

The harness uses Playwright WebKit and samples the WebKit process tree RSS with
`ps`. This is not the same metric as Safari Web Inspector's `page` category, but
it is useful for local A/B screening.

## 5 Iteration Result

Command:

```sh
node /Users/keitaro/tmp/pdfme-worktree-webkit-bench.js
```

Environment defaults:

```text
ITERATIONS=5
SAMPLE_MS=500
COOLDOWN_MS=2000
```

Result summary:

| Scenario            | before-v5lock1 max delta | current-v5lock2 max delta | Result               |
| ------------------- | -----------------------: | ------------------------: | -------------------- |
| `text-only`         |                   6.1 MB |                    6.1 MB | no meaningful change |
| `image-heavy`       |                   5.9 MB |                    6.0 MB | no meaningful change |
| `image-blob-iframe` |                   6.2 MB |                    6.0 MB | no meaningful change |

Interpretation:

At 5 iterations, the noise floor is too high to claim improvement. The blob
iframe path was already slightly higher than generation-only, but not enough to
explain real Safari crashes.

## 30 Iteration Result

Command:

```sh
ITERATIONS=30 SAMPLE_MS=1000 COOLDOWN_MS=5000 node /Users/keitaro/tmp/pdfme-worktree-webkit-bench.js
```

Result summary:

| Scenario                 | before-v5lock1 max / last delta | current-v5lock2 max / last delta | Object URLs                      | Result               |
| ------------------------ | ------------------------------: | -------------------------------: | -------------------------------- | -------------------- |
| `text-only`              |                    6.0 / 5.8 MB |                     6.2 / 6.0 MB | 0 / 0 active                     | no meaningful change |
| `image-heavy`            |                    5.9 / 5.8 MB |                     6.1 / 6.0 MB | 0 / 0 active                     | no meaningful change |
| `retained-image-wrapper` |                    5.8 / 5.8 MB |                     5.8 / 5.6 MB | 0 / 0 active                     | no meaningful change |
| `image-blob-iframe`      |                  15.3 / 15.1 MB |                   15.4 / 15.3 MB | 30 created, 30 revoked, 0 active | no meaningful change |

Interpretation:

- PDF generation alone stays near 6 MB RSS growth in both versions.
- Image-heavy generation alone also stays near 6 MB in both versions.
- Keeping image wrapper references did not amplify a visible difference in this
  WebKit harness.
- Blob iframe preview grows to about 15 MB in both versions.
- The active object URL count returns to zero, so this is not a simple missing
  `revokeObjectURL()` leak.

## Real PDF Viewer Cycle Result

Test PDF:

```text
/Users/keitaro/git/pdfme-v5lock/playground/test-3page.pdf
size: 427 KB
PDF version: 1.7
```

Temporary harness:

```text
/Users/keitaro/tmp/pdfme-test-3page-pdf-viewer-cycle.js
```

The harness uses one Playwright WebKit tab. Each cycle:

1. Fetch `test-3page.pdf`.
2. Create `Blob([arrayBuffer], { type: 'application/pdf' })`.
3. Create an object URL.
4. Display it in an iframe in the same tab.
5. Dispose by clearing the iframe, removing it, and calling
   `URL.revokeObjectURL(url)`.
6. Wait and sample WebKit/Playwright process RSS.

Command:

```sh
ITERATIONS=5 DISPLAY_MS=1500 DISPOSE_MS=10000 node /Users/keitaro/tmp/pdfme-test-3page-pdf-viewer-cycle.js
```

Result:

| Phase | RSS | Delta | Object URLs | Iframes |
| ----- | --: | ----: | ----------- | ------: |
| before | 309.0 MB | 0.0 MB | 0 created / 0 revoked / 0 active | 0 |
| after cooldown 1 | 349.4 MB | 40.4 MB | 1 created / 1 revoked / 0 active | 0 |
| after cooldown 2 | 352.2 MB | 43.2 MB | 2 created / 2 revoked / 0 active | 0 |
| after cooldown 3 | 354.3 MB | 45.3 MB | 3 created / 3 revoked / 0 active | 0 |
| after cooldown 4 | 356.7 MB | 47.7 MB | 4 created / 4 revoked / 0 active | 0 |
| after cooldown 5 | 359.2 MB | 50.2 MB | 5 created / 5 revoked / 0 active | 0 |

Shorter dispose wait produced the same shape:

```text
ITERATIONS=5 DISPLAY_MS=2500 DISPOSE_MS=3000
after cooldown 5: 358.5 MB RSS, +49.3 MB delta
```

Interpretation:

This reproduces the real Safari/WebKit failure mode more directly than the
generation-only tests. Even with no active object URLs and no iframe elements
left in the document, WebKit RSS stays elevated and grows across repeated PDF
viewer cycles. This strongly supports avoiding repeated blob PDF iframe/window
preview on Safari/iPadOS.

## Safari Measurement Plan

Playwright WebKit is useful for cheap screening, but it is not enough for the
final Safari leak decision. The next measurement path should use real Safari in
two stages.

Stage 1: replace the current browser harness with `safaridriver` +
WebdriverIO.

- Cost is low because the existing harness already serves a local HTML page and
  uses simple DOM actions.
- Use the same `test-3page.pdf` cycle first: display PDF blob URL in the same
  tab, dispose, then repeat.
- Continue sampling RSS via `ps`, but track real Safari/WebKit processes instead
  of Playwright's bundled WebKit processes.
- Keep the first metric simple: RSS delta after each dispose cooldown, object
  URL created/revoked counts, and remaining iframe count.
- Treat this as the gate for mitigation work. If real Safari does not show the
  same growth, do not optimize based only on Playwright WebKit.

Stage 2: if Stage 1 shows growth, use `xcrun xctrace` for detailed allocation
analysis.

- Capture an Instruments trace around the same 5-cycle and 30-cycle scenarios.
- Start with Allocations / Leaks / VM Tracker style data, depending on which
  templates are available locally.
- Use this only after Stage 1 confirms the signal, because trace collection is
  higher friction and less suitable for rapid iteration.

Local tool status on 2026-05-17:

```text
safaridriver: available, Safari 26.5 (21624.2.5.11.4)
WebdriverIO: installed for the Safari harness
xcrun xctrace: available after Xcode installation
Safari Remote Automation: enabled during later runs
Safari harness: scripts/safari-pdf-viewer-cycle.mjs
xctrace wrapper: scripts/xctrace-safari-pdf-cycle.mjs
```

`xctrace` became available after Xcode installation:

```text
xctrace version 16.0 (17F42)
Available templates include Allocations, Leaks, VM-adjacent Activity Monitor,
System Trace, and Time Profiler.
```

Run the Safari cycle under `xctrace`:

```sh
XCTRACE_TEMPLATE='Activity Monitor' XCTRACE_MODE=all-processes ITERATIONS=5 DISPLAY_MS=2500 DISPOSE_MS=3000 npm run bench:safari-pdf-cycle:xctrace
```

Important limitation:

- `Allocations` and `Leaks` are attach-style templates. Attaching to the normal
  Safari app process failed because the target is SIP-restricted:
  `Target process is marked restricted and cannot be traced while System
  Integrity Protection is enabled`.
- Without disabling SIP, use all-process templates such as `Activity Monitor`
  or `System Trace` for trace capture.
- For detailed `Allocations`, use a non-restricted target such as a custom
  WebKit/Safari Technology Preview setup, or run on a machine configured
  explicitly for Instruments attach.

The wrapper saves `.trace` files under:

```text
tmp/xctrace/
```

Inspect a trace table of contents:

```sh
xcrun xctrace export --input tmp/xctrace/<trace-name>.trace --toc
```

First `xctrace` Activity Monitor run:

```text
trace: tmp/xctrace/safari-pdf-cycle-activity-monitor-2026-05-17T02-23-29-858Z.trace
template: Activity Monitor
mode: all-processes
duration: 40.626492 seconds
end reason: Time limit reached
```

RSS result during that trace:

| Phase | RSS | Delta | Object URLs | Iframes |
| ----- | --: | ----: | ----------- | ------: |
| before | 1262.8 MB | 0.0 MB | 0 created / 0 revoked / 0 active | 0 |
| after dispose 1 | 1330.2 MB | 67.3 MB | 1 created / 1 revoked / 0 active | 0 |
| after dispose 2 | 1337.6 MB | 74.8 MB | 2 created / 2 revoked / 0 active | 0 |
| after dispose 3 | 1341.9 MB | 79.0 MB | 3 created / 3 revoked / 0 active | 0 |
| after dispose 4 | 1345.7 MB | 82.8 MB | 4 created / 4 revoked / 0 active | 0 |
| after dispose 5 | 1352.9 MB | 90.1 MB | 5 created / 5 revoked / 0 active | 0 |

Run the Safari harness:

```sh
ITERATIONS=5 DISPLAY_MS=2500 DISPOSE_MS=3000 npm run bench:safari-pdf-cycle
```

First real Safari result:

| Phase | RSS | Delta | Object URLs | Iframes |
| ----- | --: | ----: | ----------- | ------: |
| before | 1226.7 MB | 0.0 MB | 0 created / 0 revoked / 0 active | 0 |
| after show 1 | 1327.3 MB | 100.6 MB | 1 created / 0 revoked / 1 active | 1 |
| after dispose 1 | 1296.3 MB | 69.5 MB | 1 created / 1 revoked / 0 active | 0 |
| after show 2 | 1351.2 MB | 124.5 MB | 2 created / 1 revoked / 1 active | 1 |
| after dispose 2 | 1305.1 MB | 78.4 MB | 2 created / 2 revoked / 0 active | 0 |
| after show 3 | 1358.6 MB | 131.9 MB | 3 created / 2 revoked / 1 active | 1 |
| after dispose 3 | 1312.2 MB | 85.5 MB | 3 created / 3 revoked / 0 active | 0 |
| after show 4 | 1364.0 MB | 137.3 MB | 4 created / 3 revoked / 1 active | 1 |
| after dispose 4 | 1317.8 MB | 91.1 MB | 4 created / 4 revoked / 0 active | 0 |
| after show 5 | 1371.2 MB | 144.5 MB | 5 created / 4 revoked / 1 active | 1 |
| after dispose 5 | 1323.7 MB | 97.0 MB | 5 created / 5 revoked / 0 active | 0 |

Interpretation:

Real Safari shows the same retention shape as Playwright WebKit, and the signal
is stronger: after five display/dispose cycles, RSS remains about 97 MB above
the pre-cycle baseline even though all object URLs are revoked and all iframes
are removed.

If Safari refuses the session, enable remote automation:

```text
Safari Settings > Advanced > Show features for web developers
Develop > Allow Remote Automation
```

Alternatively, run `safaridriver --enable` with admin privileges.

## Why v5lock Disposal Did Not Fix the Real Crash

The disposal changes are still useful for JavaScript-side object graph cleanup:

- `PDFDocument.dispose()`
- `save({ dispose: true })`
- font/image/embedded page/file/javascript wrapper cleanup
- converter/generator cleanup paths

However, the crash pattern appears dominated by WebKit PDF viewer/page resource
retention. The old Safari Web Inspector recordings from the pdf-lib branch also
pointed in this direction: `page` memory grew much more than JavaScript heap.

Therefore, continuing to optimize pdf-lib internals is unlikely to fix the
Safari crash if the app still repeatedly sends new PDF blob URLs into Safari's
inline PDF viewer.

## Code Changes Started After This Finding

Initial mitigation added in `nasu/v5.5`:

```text
playground/src/helper.ts
packages/ui/src/hooks.ts
```

Intent:

- Avoid `window.open(blob:)` PDF viewer path on Safari/iOS in the playground.
- Prefer download behavior for Safari/iOS-generated PDFs.
- Revoke generated object URLs after a delay.
- Prevent stale `pdf2img` / `pdf2size` results from writing old background data
  back into UI state.
- Clear old background data when a new template/size preprocessing run starts.

Verification:

```sh
npm run -w packages/ui build
```

Status: passed.

Additional mitigation under test:

```text
packages/converter/src/index.browser.ts
packages/ui/src/helper.ts
packages/ui/src/hooks.ts
```

Intent:

- Avoid browser `canvas.toDataURL()` during `pdf2img`; use
  `canvas.toBlob()` / `OffscreenCanvas.convertToBlob()` and then
  `Blob.arrayBuffer()` instead.
- Avoid storing rendered PDF page backgrounds as large base64 data URLs in UI
  state; use image object URLs and revoke stale/old URLs.
- Avoid `basePdf -> base64 -> Uint8Array` conversion in the UI when `basePdf`
  is already an `ArrayBuffer` or `Uint8Array`.

WebKit screening harness:

```text
/Users/keitaro/tmp/pdfme-background-memory-bench.js
```

Command:

```sh
ITERATIONS=200 SAMPLE_MS=1000 COOLDOWN_MS=8000 node /Users/keitaro/tmp/pdfme-background-memory-bench.js
```

Latest 200 iteration result:

| Path | Max / last delta | Active object URLs | Result |
| ---- | ---------------: | -----------------: | ------ |
| old `toDataURL` + data URL background | 5.6 / 5.6 MB | 0 | baseline |
| new `toBlob` + object URL background | 4.5 / 4.5 MB | 0 | about 1.1 MB lower |

Earlier 200 iteration run showed a similar direction:

| Path | Max / last delta | Active object URLs | Result |
| ---- | ---------------: | -----------------: | ------ |
| old `toDataURL` + data URL background | 5.8 / 5.8 MB | 0 | baseline |
| new `toBlob` + object URL background | 5.0 / 5.0 MB | 0 | about 0.8 MB lower |

Interpretation:

This reduces browser-side peak/retained memory in the PDF-to-image background
path, but the gain is modest. It does not address WebKit's larger PDF viewer
retention problem from repeated PDF blob iframe/window preview.

Known unrelated verification blockers:

- `npm run -w packages/ui test -- hooks.test.tsx` fails before tests run because
  `canvas.node` was built for a different Node ABI.
- `playground` full build fails in this environment because of existing package
  export / missing dependency issues around `@pdfme/generator` and
  `@sentry/vite-plugin`.

## Next Improvement Direction

The next work should focus on application preview architecture, not pdf-lib
serialization internals.

Priorities:

1. Search the real app for `iframe.src = blob:`, `window.open(blob:)`,
   `<iframe src={objectUrl}>`, `URL.createObjectURL(pdfBlob)`, and PDF preview
   components.
2. For Safari/iPadOS, avoid inline PDF iframe preview.
3. Prefer one of these safer flows:
   - Generate PDF bytes and download directly.
   - Generate PDF bytes and keep only the latest bytes until a user action.
   - POST bytes to a server endpoint and open a normal HTTP PDF URL only on user
     action.
   - Navigate to a separate PDF page instead of replacing the same iframe.
4. Keep `URL.revokeObjectURL()` and `iframe.src = 'about:blank'`, but treat them
   as hygiene, not the primary fix.
5. Re-run the 30 iteration WebKit harness after each preview architecture
   change.
6. Validate the final candidate with real iPadOS Safari Web Inspector timeline
   recording, because Playwright WebKit RSS does not expose Safari's `page`
   category.

## Commands To Resume

Rebuild temporary browser bundles:

```sh
./node_modules/.bin/esbuild /Users/keitaro/git/pdfme-v5lock-before-v5lock1/packages/pdf-lib/dist/esm/src/index.js --bundle --format=esm --platform=browser --outfile=/Users/keitaro/tmp/pdfme-pdf-lib-before-v5lock1.mjs
./node_modules/.bin/esbuild /Users/keitaro/git/pdfme-v5lock/packages/pdf-lib/dist/esm/src/index.js --bundle --format=esm --platform=browser --outfile=/Users/keitaro/tmp/pdfme-pdf-lib-current-v5lock2.mjs
```

Run 30 iteration comparison:

```sh
ITERATIONS=30 SAMPLE_MS=1000 COOLDOWN_MS=5000 node /Users/keitaro/tmp/pdfme-worktree-webkit-bench.js
```

Check latest summary:

```sh
cat /Users/keitaro/tmp/pdfme-webkit-bench-results/latest-summary.csv
```

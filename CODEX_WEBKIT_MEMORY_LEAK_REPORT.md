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

## Move Investigation To `subkarte`

The library-level work in this repository is now less likely to be the main
fix. The calling application is:

```text
/Users/keitaro/git/subkarte
```

That app uses the local pdfme tarballs:

```text
vendor/pdfme/pdfme-common-5.5.11-v5lock.2.tgz
vendor/pdfme/pdfme-converter-5.5.11-v5lock.2.tgz
vendor/pdfme/pdfme-generator-5.5.11-v5lock.2.tgz
vendor/pdfme/pdfme-schemas-5.5.11-v5lock.2.tgz
vendor/pdfme/pdfme-ui-5.5.11-v5lock.2.tgz
```

Important finding in `subkarte`:

```text
/Users/keitaro/git/subkarte/src/app/client/internal-lib/pdf-handlers/pdf-form/pdf-form.component.ts
```

`PdfFormComponent` has two generated PDF preview/print paths that create a PDF
blob URL and send it to Safari's PDF viewer:

- `Print()` creates `new Blob([pdfData], { type: 'application/pdf' })`,
  calls `URL.createObjectURL(blob)`, then assigns the blob URL to
  `newWindow.location.href`.
- `MakePdf()` does the same.

This is not literally `iframe.src = blob:`, but it is the same WebKit problem
class: repeatedly passing `blob:` PDF URLs into Safari's built-in PDF viewer.
The real Safari and Simulator Safari tests in this report strongly suggest this
path can retain WebKit PDF viewer memory even when object URLs are revoked.

There is also a correctness issue in the current `subkarte` code:

- `Print()` and `MakePdf()` call `this.asyncMakePdf(true).then(...)` inside a
  `try` block but do not `await` it.
- Their `finally` blocks run before the `then(...)` callback creates `blobUrl`.
- Therefore the current `URL.revokeObjectURL(blobUrl)` cleanup is likely not
  running for the generated PDF blob URLs.

Recommended next work should happen in `/Users/keitaro/git/subkarte`, not in
this library repository:

1. Add/port the Safari or Simulator Safari RSS harness to exercise the actual
   `PdfFormComponent.MakePdf()` / `Print()` flow.
2. First fix the async structure so `asyncMakePdf()` is awaited and
   `URL.revokeObjectURL()` definitely runs.
3. Re-test. If WebKit RSS still grows, avoid `blob:` PDF viewer preview on
   WebKit/iPadOS.
4. Prefer WebKit-safe alternatives: direct download, server-backed HTTP PDF URL,
   or a non-inline user-action flow.
5. Also inspect other app-level `URL.createObjectURL(pdfBlob)` paths, especially
   report PDF merge/preview code.

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

## Playwright WebKit Screening

Playwright WebKit was used only as an early, low-cost screening tool. It showed
that the pdf-lib disposal changes did not materially change repeated generation
or blob iframe preview RSS, and it helped shape the next tests.

Do not treat the Playwright numbers as decision-grade Safari evidence:

- It uses Playwright's bundled WebKit, not real Safari.
- Its process/RSS shape differs from Safari and iPadOS Safari.
- It does not expose Safari Web Inspector's `page` memory category.

The useful takeaway was limited: a real Safari/iPadOS-oriented test is needed,
and active object URL count returning to zero does not prove the PDF viewer
resources were released.

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

## Simulator Safari Check

Because macOS Safari `Allocations`/`Leaks` attach hits SIP restrictions, the
next idea was to use iOS Simulator Safari with `simctl` and `leaks`.

Booted device used:

```text
iOS 18.4
iPad Pro 11-inch (M4)
UDID: E0430610-1424-4517-962B-2A9302E6350E
```

Conceptual target flow:

```sh
xcrun simctl openurl booted "http://127.0.0.1:<port>/"
xcrun simctl spawn booted leaks <pid> --outputGraph=before.memgraph
# run repeated PDF display/dispose cycle
xcrun simctl spawn booted leaks <pid> --diffFrom=before.memgraph
```

Actual test:

- Served an auto-running local page.
- Opened it in Simulator Safari via `xcrun simctl openurl booted`.
- The page repeatedly fetched `playground/test-3page.pdf`, created a PDF blob
  URL, displayed it in an iframe, cleared the iframe, and revoked the URL.
- The page reported each phase back to the local server.
- The harness sampled host-side Simulator MobileSafari/WebContent/Networking/GPU
  RSS with `ps`.

Result after 5 cycles:

| Phase | RSS | Object URLs | Iframes |
| ----- | --: | ----------- | ------: |
| ready | 748.0 MB | 0 created / 0 revoked / 0 active | 0 |
| after dispose 1 | 957.6 MB | 1 created / 1 revoked / 0 active | 0 |
| after dispose 2 | 984.0 MB | 2 created / 2 revoked / 0 active | 0 |
| after dispose 3 | 1011.7 MB | 3 created / 3 revoked / 0 active | 0 |
| after dispose 4 | 1021.4 MB | 4 created / 4 revoked / 0 active | 0 |
| after dispose 5 | 1023.0 MB | 5 created / 5 revoked / 0 active | 0 |

```text
delta-ready-to-complete: +275.1 MB
```

Interpretation:

Simulator Safari can detect the leak signal very clearly with RSS. This is a
good candidate for automated regression comparison after preview architecture
changes.

`leaks`/memgraph status:

- Host-side `leaks --outputGraph ... <WebContent PID>` failed:
  `Failed to get DYLD info for task from parent ... (os/kern) failure (5)`.
- Simulator-side `xcrun simctl spawn booted leaks ... <WebContent PID>` failed:
  `leaks cannot examine process ... try running with sudo` and
  `mach port for process 0 not valid`.
- `xcrun simctl spawn booted /usr/bin/pgrep` was unreliable in this environment
  (`sysmond service not found`), but `xcrun simctl spawn booted /bin/ps -A`
  could list the relevant processes.

Current conclusion:

- Simulator Safari + RSS is useful now.
- `leaks --outputGraph` / `--diffFrom` is not currently usable against Simulator
  Safari/WebContent without additional permissions or a different attach target.
- Continue using RSS for fast automated comparisons; revisit memgraph only if a
  reliable process attach path is found.

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

Playwright WebKit screening showed a small improvement in the background image
path, but not enough to matter for the Safari PDF viewer crash. Keep the code
change because it avoids unnecessary base64 strings, but do not spend more time
on Playwright-only memory numbers.

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
5. Re-run the real Safari harness after each preview architecture change.
6. Use Simulator + `leaks`/memgraph if it can produce useful diffs without SIP
   restrictions.

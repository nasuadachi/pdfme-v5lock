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
commit: 712c7414 test(pdf-lib): cover svg rendering fixtures
label: current-v5lock2
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

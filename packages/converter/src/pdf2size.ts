import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Size, pt2mm } from '@pdfme/common';

interface Environment {
  getDocument: (pdf: ArrayBuffer | Uint8Array) => Promise<PDFDocumentProxy>;
}

const DEFAULT_PAGE_CONCURRENCY = 2;

export interface Pdf2SizeOptions {
  scale?: number;
  /**
   * Maximum number of pages to inspect concurrently.
   * Defaults to 2 to reduce memory pressure in browser/mobile runtimes.
   */
  concurrency?: number;
}

const normalizeConcurrency = (concurrency?: number): number => {
  if (concurrency === undefined || !Number.isFinite(concurrency)) {
    return DEFAULT_PAGE_CONCURRENCY;
  }
  return Math.max(1, Math.floor(concurrency));
};

const runWithConcurrency = async <T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> => {
  const results = new Array<PromiseSettledResult<T>>(count);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, count);
  const workers = new Array(workerCount).fill(undefined).map(async () => {
    while (nextIndex < count) {
      const index = nextIndex;
      nextIndex += 1;

      try {
        results[index] = { status: 'fulfilled', value: await task(index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
};

export async function pdf2size(
  pdf: ArrayBuffer | Uint8Array,
  options: Pdf2SizeOptions = {},
  env: Environment,
): Promise<Size[]> {
  const { scale = 1 } = options;
  const concurrency = normalizeConcurrency(options.concurrency);
  const { getDocument } = env;

  const pdfDoc = await getDocument(pdf);

  try {
    const results = await runWithConcurrency(pdfDoc.numPages, concurrency, async (i) => {
      const page = await pdfDoc.getPage(i + 1);
      try {
        const { height, width } = page.getViewport({ scale, rotation: 0 });

        return { height: pt2mm(height), width: pt2mm(width) };
      } finally {
        page.cleanup();
      }
    });

    const sizes: Size[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      if (result.status === 'rejected') {
        throw result.reason;
      }
      sizes.push(result.value);
    }
    return sizes;
  } finally {
    await pdfDoc.destroy();
  }
}

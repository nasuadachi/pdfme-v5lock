import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Size, pt2mm } from '@pdfme/common';

interface Environment {
  getDocument: (pdf: ArrayBuffer | Uint8Array) => Promise<PDFDocumentProxy>;
}

export interface Pdf2SizeOptions {
  scale?: number;
}

export async function pdf2size(
  pdf: ArrayBuffer | Uint8Array,
  options: Pdf2SizeOptions = {},
  env: Environment,
): Promise<Size[]> {
  const { scale = 1 } = options;
  const { getDocument } = env;

  const pdfDoc = await getDocument(pdf);

  try {
    const results = await Promise.allSettled(
      new Array(pdfDoc.numPages).fill('').map(async (_, i) => {
        const page = await pdfDoc.getPage(i + 1);
        try {
          const { height, width } = page.getViewport({ scale, rotation: 0 });

          return { height: pt2mm(height), width: pt2mm(width) };
        } finally {
          page.cleanup();
        }
      }),
    );

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

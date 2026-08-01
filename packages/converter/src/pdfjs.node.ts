export type PdfJsLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export const loadPdfJs = (): Promise<PdfJsLib> => import('pdfjs-dist/legacy/build/pdf.mjs');

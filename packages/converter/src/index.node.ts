import { createCanvas } from 'canvas';
import { pdf2img as _pdf2img, Pdf2ImgOptions } from './pdf2img.js';
import { pdf2size as _pdf2size, Pdf2SizeOptions } from './pdf2size.js';

type PdfJsLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

const importPdfJs = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<PdfJsLib>;

let pdfJsLibPromise: Promise<PdfJsLib> | undefined;

const getPdfJsLib = async () => {
  pdfJsLibPromise ??= importPdfJs('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfJsLibPromise;
};

const clonePdfData = (pdf: ArrayBuffer | Uint8Array) =>
  pdf instanceof Uint8Array ? new Uint8Array(pdf) : new Uint8Array(pdf);

const getDocument = async (pdf: ArrayBuffer | Uint8Array) => {
  const pdfjsLib = await getPdfJsLib();
  return pdfjsLib.getDocument({
    data: clonePdfData(pdf),
    isEvalSupported: false,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  }).promise;
};

export const pdf2img = async (
  pdf: ArrayBuffer | Uint8Array,
  options: Pdf2ImgOptions = {},
): Promise<ArrayBuffer[]> =>
  _pdf2img(pdf, { ...options, imageType: options.imageType ?? 'png' }, {
    getDocument,
    createCanvas: (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
    canvasToArrayBuffer: (canvas, imageType) => {
      // Using a more specific type for the canvas from the 'canvas' package
      const nodeCanvas = canvas as unknown as import('canvas').Canvas;
      const buffer =
        imageType === 'png' ? nodeCanvas.toBuffer('image/png') : nodeCanvas.toBuffer('image/jpeg');
      // Convert to ArrayBuffer
      const arrayBuffer = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(arrayBuffer).set(buffer);
      return arrayBuffer;
    },
  });

export const pdf2size = async (pdf: ArrayBuffer | Uint8Array, options: Pdf2SizeOptions = {}) =>
  _pdf2size(pdf, options, {
    getDocument,
  });

export { img2pdf } from './img2pdf.js';

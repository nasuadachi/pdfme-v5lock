import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
// @ts-expect-error - PDFJSWorker import is not properly typed but required for functionality
import PDFJSWorker from 'pdfjs-dist/legacy/build/pdf.worker.js';
import { createCanvas } from 'canvas';
import { pdf2img as _pdf2img, Pdf2ImgOptions } from './pdf2img.js';
import { pdf2size as _pdf2size, Pdf2SizeOptions } from './pdf2size.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJSWorker as unknown as string;
const pdfJsDocumentOptions = {
  isEvalSupported: false,
  verbosity: pdfjsLib.VerbosityLevel.ERRORS,
};

export const pdf2img = async (
  pdf: ArrayBuffer | Uint8Array,
  options: Pdf2ImgOptions = {},
): Promise<ArrayBuffer[]> =>
  _pdf2img(pdf, { ...options, imageType: options.imageType ?? 'png' }, {
    getDocument: (pdf) => pdfjsLib.getDocument({ data: pdf, ...pdfJsDocumentOptions }).promise,
    createCanvas: (width, height) => createCanvas(width, height) as unknown as HTMLCanvasElement,
    canvasToArrayBuffer: (canvas, imageType) => {
      // Using a more specific type for the canvas from the 'canvas' package
      const nodeCanvas = canvas as unknown as import('canvas').Canvas;
      const buffer =
        imageType === 'png' ? nodeCanvas.toBuffer('image/png') : nodeCanvas.toBuffer('image/jpeg');
      // Convert to ArrayBuffer
      return new Uint8Array(buffer).buffer;
    },
  });

export const pdf2size = async (pdf: ArrayBuffer | Uint8Array, options: Pdf2SizeOptions = {}) =>
  _pdf2size(pdf, options, {
    getDocument: (pdf) => pdfjsLib.getDocument({ data: pdf, ...pdfJsDocumentOptions }).promise,
  });

export { img2pdf } from './img2pdf.js';

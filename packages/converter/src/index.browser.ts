import * as pdfjsLib from 'pdfjs-dist';
// @ts-expect-error - PDFJSWorker import is not properly typed but required for functionality
import PDFJSWorker from 'pdfjs-dist/build/pdf.worker.entry.js';
import { pdf2img as _pdf2img, Pdf2ImgOptions } from './pdf2img.js';
import { pdf2size as _pdf2size, Pdf2SizeOptions } from './pdf2size.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJSWorker as unknown as string;
const pdfJsDocumentOptions = {
  isEvalSupported: false,
  verbosity: pdfjsLib.VerbosityLevel.ERRORS,
};

const canvasToBlob = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  imageType: string,
): Promise<Blob> => {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: `image/${imageType}` });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, `image/${imageType}`);
  });
};

const canvasToArrayBuffer = async (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  imageType: string,
): Promise<ArrayBuffer> => {
  const blob = await canvasToBlob(canvas, imageType);
  return blob.arrayBuffer();
};

export const pdf2img = async (
  pdf: ArrayBuffer | Uint8Array,
  options: Pdf2ImgOptions = {},
): Promise<ArrayBuffer[]> =>
  _pdf2img(pdf, options, {
    getDocument: (pdf) => pdfjsLib.getDocument({ data: pdf, ...pdfJsDocumentOptions }).promise,
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    canvasToArrayBuffer,
  });

export const pdf2size = async (pdf: ArrayBuffer | Uint8Array, options: Pdf2SizeOptions = {}) =>
  _pdf2size(pdf, options, {
    getDocument: (pdf) => pdfjsLib.getDocument({ data: pdf, ...pdfJsDocumentOptions }).promise,
  });

export { img2pdf } from './img2pdf.js';

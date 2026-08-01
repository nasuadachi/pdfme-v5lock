import { jest } from '@jest/globals';
import { PDFDocument } from '@pdfme/pdf-lib';
import { img2pdf } from '../src/img2pdf.js';

describe('img2pdf disposal', () => {
  test('disposes document when image processing fails', async () => {
    const disposeSpy = jest.spyOn(PDFDocument.prototype, 'dispose');
    const invalidImage = new ArrayBuffer(10);

    try {
      await expect(img2pdf([invalidImage])).rejects.toThrow('Failed to process image');
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });
});

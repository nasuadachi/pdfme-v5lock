// @ts-ignore
import { generate } from '@pdfme/generator';
import { pdf2img as nodePdf2Img, pdf2size as nodePdf2Size, img2pdf } from '../src/index.node.js';
import { pdf2img as rawPdf2Img } from '../src/pdf2img.js';
import { pdf2size as rawPdf2Size } from '../src/pdf2size.js';

const isJpeg = (image: ArrayBuffer) => {
  const bytes = new Uint8Array(image);
  return bytes[0] === 0xff && bytes[1] === 0xd8;
};

const isPng = (image: ArrayBuffer) => {
  const bytes = new Uint8Array(image);
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
};

describe('pdf2img tests', () => {
  let pdfArrayBuffer: ArrayBuffer | Uint8Array;

  beforeAll(async () => {
    const pdf = await generate({
      template: {
        schemas: [
          [
            {
              name: 'field1',
              type: 'text',
              content: 'Type Something...',
              position: { x: 10, y: 20 },
              width: 45,
              height: 10,
            },
          ],
        ],
        basePdf: { width: 210, height: 297, padding: [20, 10, 20, 10] },
        pdfmeVersion: '5.2.16',
      },
      inputs: [{}, {}, {}, {}],
    });
    pdfArrayBuffer = new Uint8Array(pdf.buffer);
  });

  test('Node.js version - returns array of images', async () => {
    const images = await nodePdf2Img(pdfArrayBuffer, { scale: 1 });
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBe(4);
    expect(images[0]).toBeInstanceOf(ArrayBuffer);
    expect(images[0].byteLength).toBeGreaterThan(0);
  });

  test('Node.js version - respects imageType option', async () => {
    const [defaultImage] = await nodePdf2Img(pdfArrayBuffer, {
      scale: 1,
      range: { start: 0, end: 0 },
    });
    const [jpegImage] = await nodePdf2Img(pdfArrayBuffer, {
      scale: 1,
      imageType: 'jpeg',
      range: { start: 0, end: 0 },
    });
    const [pngImage] = await nodePdf2Img(pdfArrayBuffer, {
      scale: 1,
      imageType: 'png',
      range: { start: 0, end: 0 },
    });

    expect(isPng(defaultImage)).toBe(true);
    expect(isJpeg(jpegImage)).toBe(true);
    expect(isPng(pngImage)).toBe(true);
  });

  test('pageNumbers option - should render only specified pages', async () => {
    const images = await nodePdf2Img(pdfArrayBuffer, {
      scale: 1,
      range: { start: 0, end: 1 },
    });

    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBe(2);

    images.forEach((img) => {
      expect(img).toBeInstanceOf(ArrayBuffer);
      expect(img.byteLength).toBeGreaterThan(0);
    });
  });

  test('invalid PDF input - should throw error', async () => {
    const invalidBuffer = new ArrayBuffer(10);
    await expect(nodePdf2Img(invalidBuffer, { scale: 1 })).rejects.toThrow('Invalid PDF');
  });

  test('empty buffer input - should throw error', async () => {
    const emptyBuffer = new ArrayBuffer(0);
    await expect(nodePdf2Img(emptyBuffer, { scale: 1 })).rejects.toThrow(
      'The PDF file is empty, i.e. its size is zero by'
    );
  });

  test('cleans up page and destroys document when rendering fails', async () => {
    const cleanup = jest.fn();
    const destroy = jest.fn().mockResolvedValue(undefined);
    const page = {
      getViewport: jest.fn().mockReturnValue({ width: 10, height: 10 }),
      render: jest.fn().mockReturnValue({ promise: Promise.reject(new Error('render failed')) }),
      cleanup,
    };
    const pdfDoc = {
      numPages: 1,
      getPage: jest.fn().mockResolvedValue(page),
      destroy,
    };
    const canvas = {
      getContext: jest.fn().mockReturnValue({}),
    } as unknown as HTMLCanvasElement;
    const env = {
      getDocument: jest.fn().mockResolvedValue(pdfDoc),
      createCanvas: jest.fn().mockReturnValue(canvas),
      canvasToArrayBuffer: jest.fn(),
    } as unknown as Parameters<typeof rawPdf2Img>[2];

    await expect(rawPdf2Img(new Uint8Array([1]), {}, env)).rejects.toThrow('render failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
describe('img2pdf tests', () => {
  let jpegImage: ArrayBuffer;
  let pngImage: ArrayBuffer;

  beforeAll(async () => {
    // Create test images using pdf2img for testing
    const pdf = await generate({
      template: {
        schemas: [
          [
            {
              name: 'field1',
              type: 'text',
              content: 'Type Something...',
              position: { x: 10, y: 20 },
              width: 45,
              height: 10,
            },
          ],
        ],
        basePdf: { width: 210, height: 297, padding: [20, 10, 20, 10] },
        pdfmeVersion: '5.2.16',
      },
      inputs: [{}],
    });
    const images = await nodePdf2Img(new Uint8Array(pdf.buffer), { scale: 1 });
    jpegImage = images[0];
    pngImage = images[0]; // Using same image for both tests
  });

  test('converts single image to PDF', async () => {
    const pdf = await img2pdf([jpegImage]);
    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  test('converts multiple images to single PDF', async () => {
    const pdf = await img2pdf([jpegImage, pngImage]);
    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  test('handles scale option', async () => {
    const pdf = await img2pdf([jpegImage], { scale: 0.5 });
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  test('throws error for empty input', async () => {
    await expect(img2pdf([])).rejects.toThrow('Input must be a non-empty array');
  });

  test('throws error for invalid image', async () => {
    const invalidImage = new ArrayBuffer(10);
    await expect(img2pdf([invalidImage])).rejects.toThrow('Failed to process image');
  });

  test('handles size option', async () => {
    const customSize = { width: 100, height: 150 }; // in millimeters
    const pdf = await img2pdf([jpegImage], { size: customSize });
    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
  
  test('handles margin option', async () => {
    const margins: [number, number, number, number] = [10, 20, 30, 40]; // in millimeters [top, right, bottom, left]
    const pdf = await img2pdf([jpegImage], { margin: margins });
    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
  
  test('handles both size and margin options', async () => {
    const customSize = { width: 100, height: 150 }; // in millimeters
    const margins: [number, number, number, number] = [10, 20, 30, 40]; // in millimeters [top, right, bottom, left]
    const pdf = await img2pdf([jpegImage], { 
      size: customSize, 
      margin: margins 
    });
    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
  
  test('uses default margin [0,0,0,0] when margin is omitted', async () => {
    // This test verifies the default behavior is maintained
    const pdf1 = await img2pdf([jpegImage]);
    const pdf2 = await img2pdf([jpegImage], { margin: [0, 0, 0, 0] as [number, number, number, number] });
    // Both PDFs should have the same size
    expect(pdf1.byteLength).toBe(pdf2.byteLength);
  });
});

describe('pdf2size tests', () => {
  let pdfArrayBuffer: ArrayBuffer | Uint8Array;

  beforeAll(async () => {
    const pdf = await generate({
      template: {
        schemas: [
          [
            {
              name: 'field1',
              type: 'text',
              content: 'Type Something...',
              position: { x: 10, y: 20 },
              width: 45,
              height: 10,
            },
          ],
        ],
        basePdf: { width: 210, height: 297, padding: [20, 10, 20, 10] },
        pdfmeVersion: '5.2.16',
      },
      inputs: [{}, {}, {}, {}],
    });
    pdfArrayBuffer = new Uint8Array(pdf.buffer);
  });

  test('returns array of page sizes', async () => {
    const sizes = await nodePdf2Size(pdfArrayBuffer, { scale: 1 });
    expect(Array.isArray(sizes)).toBe(true);
    expect(sizes.length).toBe(4);
    sizes.forEach((size) => {
      expect(typeof size.width).toBe('number');
      expect(typeof size.height).toBe('number');
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    });
  });

  test('scale option - properly adjusts size', async () => {
    const scale = 0.5;
    const sizes = await nodePdf2Size(pdfArrayBuffer, { scale });
    sizes.forEach((size) => {
      expect(size.width).toBeLessThan(200);
      expect(size.height).toBeLessThan(300);
    });
  });

  test('invalid PDF input - should throw error', async () => {
    const invalidBuffer = new ArrayBuffer(10);
    await expect(nodePdf2Size(invalidBuffer, { scale: 1 })).rejects.toThrow('Invalid PDF');
  });

  test('empty buffer input - should throw error', async () => {
    const emptyBuffer = new ArrayBuffer(0);
    await expect(nodePdf2Size(emptyBuffer, { scale: 1 })).rejects.toThrow(
      'The PDF file is empty, i.e. its size is zero by'
    );
  });

  test('waits for page cleanup before destroying document when a page fails', async () => {
    const order: string[] = [];
    const failingPage = {
      getViewport: jest.fn(() => {
        throw new Error('size failed');
      }),
      cleanup: jest.fn(() => order.push('cleanup1')),
    };
    const slowPage = {
      getViewport: jest.fn(() => ({ width: 20, height: 30 })),
      cleanup: jest.fn(() => order.push('cleanup2')),
    };
    const pdfDoc = {
      numPages: 2,
      getPage: jest.fn(async (pageNumber: number) => {
        if (pageNumber === 2) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return pageNumber === 1 ? failingPage : slowPage;
      }),
      destroy: jest.fn(async () => {
        order.push('destroy');
      }),
    };
    const env = {
      getDocument: jest.fn().mockResolvedValue(pdfDoc),
    } as unknown as Parameters<typeof rawPdf2Size>[2];

    await expect(rawPdf2Size(new Uint8Array([1]), {}, env)).rejects.toThrow('size failed');
    expect(order).toEqual(['cleanup1', 'cleanup2', 'destroy']);
  });

  test('limits page processing to 2 concurrent pages by default', async () => {
    let activePages = 0;
    let maxActivePages = 0;
    const pdfDoc = {
      numPages: 5,
      getPage: jest.fn(async () => {
        activePages += 1;
        maxActivePages = Math.max(maxActivePages, activePages);
        await new Promise((resolve) => setTimeout(resolve, 5));

        return {
          getViewport: jest.fn(() => ({ width: 20, height: 30 })),
          cleanup: jest.fn(() => {
            activePages -= 1;
          }),
        };
      }),
      destroy: jest.fn(),
    };
    const env = {
      getDocument: jest.fn().mockResolvedValue(pdfDoc),
    } as unknown as Parameters<typeof rawPdf2Size>[2];

    const sizes = await rawPdf2Size(new Uint8Array([1]), {}, env);

    expect(sizes).toHaveLength(5);
    expect(maxActivePages).toBe(2);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });

  test('allows custom page processing concurrency', async () => {
    let activePages = 0;
    let maxActivePages = 0;
    const pdfDoc = {
      numPages: 6,
      getPage: jest.fn(async () => {
        activePages += 1;
        maxActivePages = Math.max(maxActivePages, activePages);
        await new Promise((resolve) => setTimeout(resolve, 5));

        return {
          getViewport: jest.fn(() => ({ width: 20, height: 30 })),
          cleanup: jest.fn(() => {
            activePages -= 1;
          }),
        };
      }),
      destroy: jest.fn(),
    };
    const env = {
      getDocument: jest.fn().mockResolvedValue(pdfDoc),
    } as unknown as Parameters<typeof rawPdf2Size>[2];

    const sizes = await rawPdf2Size(new Uint8Array([1]), { concurrency: 3 }, env);

    expect(sizes).toHaveLength(6);
    expect(maxActivePages).toBe(3);
    expect(pdfDoc.destroy).toHaveBeenCalledTimes(1);
  });
});

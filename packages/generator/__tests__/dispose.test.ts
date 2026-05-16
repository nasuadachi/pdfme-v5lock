import { BLANK_A4_PDF, type Plugin, type Schema, type Template } from '@pdfme/common';
import { PDFDocument } from '@pdfme/pdf-lib';
import generate from '../src/generate.js';
import { preprocessing } from '../src/helper.js';

const schemaForType = (type: string): Schema => ({
  name: 'field',
  type,
  content: '',
  position: { x: 0, y: 0 },
  width: 10,
  height: 10,
});

const templateForType = (type: string): Template => ({
  basePdf: BLANK_A4_PDF,
  schemas: [[schemaForType(type)]],
});

const pluginForType = (type: string, pdf: Plugin['pdf']): Plugin => ({
  pdf,
  ui: () => {},
  propPanel: {
    schema: {},
    defaultSchema: schemaForType(type),
  },
});

describe('PDFDocument disposal on generator failures', () => {
  test('generate disposes the document when rendering fails', async () => {
    const disposeSpy = jest.spyOn(PDFDocument.prototype, 'dispose');
    const type = 'throwing';

    try {
      await expect(
        generate({
          template: templateForType(type),
          inputs: [{ field: 'value' }],
          plugins: {
            throwing: pluginForType(type, () => {
              throw new Error('render failed');
            }),
          },
        }),
      ).rejects.toThrow('render failed');

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  test('preprocessing disposes the document when renderer lookup fails', async () => {
    const disposeSpy = jest.spyOn(PDFDocument.prototype, 'dispose');

    try {
      await expect(
        preprocessing({ template: templateForType('missingRenderer'), userPlugins: {} }),
      ).rejects.toThrow('Plugin or renderer for type missingRenderer not found');

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });
});

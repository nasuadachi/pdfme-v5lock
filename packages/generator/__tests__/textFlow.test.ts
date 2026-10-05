import { BLANK_PDF, type Plugin, type Schema, type Template } from '@pdfme/common';
import generate from '../src/generate.js';

const field = (name: string, required = false): Schema => ({
  name,
  type: 'text',
  position: { x: 0, y: 0 },
  width: 50,
  height: 10,
  required,
});

describe('opted-in legacy text keys during PDF generation', () => {
  const values: Record<string, string> = {};
  const plugin: Plugin = {
    ui: () => undefined,
    pdf: ({ value, schema, page }) => {
      values[schema.name] = value;
      if (value) page.drawText(value, { x: 10, y: 10 });
    },
    propPanel: { schema: {}, defaultSchema: field('text1') },
  };
  beforeEach(() => {
    Object.keys(values).forEach((name) => delete values[name]);
  });

  it('hydrates before required validation and rendering, preserving other expression inputs', async () => {
    const template: Template = {
      basePdf: BLANK_PDF,
      schemas: [
        [
          field('text001-20', true),
          field('text02-8'),
          { ...field('summary'), readOnly: true, content: '{text001}' },
        ],
      ],
    };
    const inputs = [{ text001: 'legacy', text02: 'other', untouched: 'keep' }];
    const result = await generate({
      template,
      inputs,
      plugins: { Text: plugin },
      options: { textFlow: { enabled: true } },
    });
    expect(result.length).toBeGreaterThan(100);
    expect(values['text001-20']).toBe('legacy');
    expect(values['text02-8']).toBe('other');
    expect(values.summary).toBe('legacy');
    expect(inputs).toEqual([{ text001: 'legacy', text02: 'other', untouched: 'keep' }]);
  });

  it('preserves a present current empty key and leaves disabled generation unchanged', async () => {
    const template: Template = { basePdf: BLANK_PDF, schemas: [[field('text1-20')]] };
    await generate({
      template,
      inputs: [{ 'text1-20': '', text1: 'old' }],
      plugins: { Text: plugin },
      options: { textFlow: { enabled: true } },
    });
    expect(values['text1-20']).toBe('');
    await generate({ template, inputs: [{ text1: 'old' }], plugins: { Text: plugin } });
    expect(values['text1-20']).toBe('');
  });
});

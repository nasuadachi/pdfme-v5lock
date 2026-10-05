import { getDynamicTemplate, getDefaultFont, type Schema, type Template } from '@pdfme/common';
import { getDynamicHeightsForTable } from '@pdfme/schemas/utils';
import { table } from '@pdfme/schemas';
import { TextFlowController } from '../src/textFlow';

const row = (name: string, y: number): Schema => ({
  name,
  type: 'text',
  position: { x: 10, y },
  width: 70,
  height: 6,
});

test('a real expanded table separates flow groups by displayed page and shrinking restores the group', async () => {
  const tableSchema = {
    ...table.propPanel.defaultSchema,
    name: 'items',
    position: { x: 10, y: 25 },
    width: 70,
    height: 10,
  } as Schema;
  const original: Template = {
    basePdf: { width: 100, height: 100, padding: [10, 10, 10, 10] },
    schemas: [[row('text1-1', 10), tableSchema, row('text2-1', 60)]],
  };
  const inputs = {
    'text1-1': '',
    'text2-1': '',
    items: JSON.stringify(Array.from({ length: 16 }, () => ['a', 'b', 'c'])),
  };
  const layout = (input: typeof inputs) =>
    getDynamicTemplate({
      template: original,
      input,
      options: { font: getDefaultFont() },
      _cache: new Map(),
      getDynamicHeights: (value, args) =>
        args.schema.type === 'table'
          ? getDynamicHeightsForTable(value, args)
          : Promise.resolve([args.schema.height]),
    });
  const expanded = await layout(inputs);
  const sourcePage = expanded.schemas.findIndex((page) => page.some((s) => s.name === 'text1-1'));
  const targetPage = expanded.schemas.findIndex((page) => page.some((s) => s.name === 'text2-1'));
  expect(sourcePage).toBe(0);
  expect(targetPage).toBeGreaterThan(0);
  let committed = [{ ...inputs }];
  const notice = jest.fn();
  const controller = new TextFlowController(
    () => original,
    committed,
    () => ({ enabled: true, onNotice: notice }),
    (next) => {
      committed = next as typeof committed;
    },
  );
  controller.setDisplayedSchemas(0, expanded.schemas);
  const source = expanded.schemas[sourcePage].find((s) => s.name === 'text1-1')!;
  const target = expanded.schemas[targetPage].find((s) => s.name === 'text2-1')!;
  expect(controller.getBinding(0, targetPage, target)).toBeDefined();
  controller.getBinding(0, sourcePage, source)!.commitEdit({
    value: 'あい',
    selection: { anchor: 2, focus: 2 },
  });
  expect(committed[0]['text1-1']).toBe('');
  expect(committed[0]['text2-1']).toBe('');
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ type: 'overflow' }));

  const collapsed = await layout({ ...inputs, items: '[]' });
  expect(collapsed.schemas.findIndex((page) => page.some((s) => s.name === 'text2-1'))).toBe(0);
  controller.setDisplayedSchemas(0, collapsed.schemas);
  controller.getBinding(0, 0, source)!.commitEdit({
    value: 'あい',
    selection: { anchor: 2, focus: 2 },
  });
  expect(committed[0]['text1-1']).toBe('あ');
  expect(committed[0]['text2-1']).toBe('い');
});

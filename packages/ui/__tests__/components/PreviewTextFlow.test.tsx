import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import {
  getDynamicTemplate,
  type Schema,
  type SchemaForUI,
  type Template,
  type TextFlowBinding,
} from '@pdfme/common';
import Preview from '../../src/components/Preview';
import { TextFlowController } from '../../src/textFlow';

const mockRenderers = new Map<
  string,
  {
    schema: SchemaForUI;
    textFlow?: TextFlowBinding;
    onChange: (arg: { key: string; value: string }) => void;
  }
>();
jest.mock('../../src/components/Renderer', () => ({
  __esModule: true,
  default: (props: typeof mockRenderers extends Map<string, infer P> ? P : never) => {
    mockRenderers.set(props.schema.name, props);
    return React.createElement('div', { 'data-testid': props.schema.name });
  },
}));
jest.mock('@pdfme/common', () => ({
  ...jest.requireActual('@pdfme/common'),
  getDynamicTemplate: jest.fn(),
}));
jest.mock('../../src/hooks', () => ({
  useUIPreProcessor: () => ({
    backgrounds: [],
    pageSizes: [],
    scale: 1,
    error: null,
    refresh: async () => {},
  }),
  useScrollPageCursor: () => {},
}));
jest.mock('../../src/helper', () => ({
  useMaxZoom: () => 1,
  getPagesScrollTopByIndex: () => 0,
  template2SchemasList: async (template: Template) =>
    template.schemas.map((page, index) =>
      page.map((schema) => ({ ...schema, id: `${index}-${schema.name}` })),
    ),
}));
jest.mock('../../src/components/Root', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
jest.mock('../../src/components/StaticSchema', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/components/CtlBar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/components/UnitPager', () => ({
  __esModule: true,
  default: ({ setUnitCursor }: { setUnitCursor: (index: number) => void }) =>
    React.createElement('button', { onClick: () => setUnitCursor(1) }, 'next unit'),
}));
jest.mock('../../src/components/Paper', () => ({
  __esModule: true,
  default: ({
    schemasList,
    renderSchema,
  }: {
    schemasList: SchemaForUI[][];
    renderSchema: (arg: { schema: SchemaForUI; index: number }) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      null,
      schemasList.flatMap((page) =>
        page.map((schema, index) =>
          React.createElement(React.Fragment, { key: schema.id }, renderSchema({ schema, index })),
        ),
      ),
    ),
}));

const row = (name: string): Schema => ({
  name,
  type: 'text',
  position: { x: 0, y: 0 },
  width: 20,
  height: 5,
});
const source = row('text1-1');
const target = row('text2-1');
const tableSchema = { ...row('items'), type: 'table' };
const template: Template = {
  basePdf: { width: 100, height: 100, padding: [10, 10, 10, 10] },
  schemas: [[source, tableSchema, target]],
};
const expanded: Template = { ...template, schemas: [[source, tableSchema], [target]] };
const mockDynamic = getDynamicTemplate as jest.MockedFunction<typeof getDynamicTemplate>;

beforeEach(() => {
  mockRenderers.clear();
  mockDynamic.mockReset();
  mockDynamic.mockImplementation(async ({ input }) =>
    input.items === 'expanded' ? expanded : template,
  );
});

test('Preview waits for queued table input before publishing new visible flow groups', async () => {
  const inputs = [{ 'text1-1': '甲', 'text2-1': '乙', items: 'flat' }];
  let resolve!: (value: boolean) => void;
  const controller = new TextFlowController(
    () => template,
    inputs,
    () => ({
      enabled: true,
      onBeforeDiscard: () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    }),
    (next) => {
      inputs.splice(0, inputs.length, ...(next as typeof inputs));
    },
  );
  render(
    <Preview
      template={template}
      inputs={inputs}
      size={{ width: 500, height: 500 }}
      textFlowController={controller}
      onChangeInput={({ index, name, value }) => controller.changeInput(index, name, value)}
    />,
  );
  await waitFor(() => expect(mockRenderers.get('text2-1')?.textFlow).toBeDefined());
  const oldSource = mockRenderers.get('text1-1')!.textFlow!;
  act(() => {
    oldSource.commitEdit({ value: '甲丙', selection: { anchor: 2, focus: 2 } });
    mockRenderers.get('items')!.onChange({ key: 'content', value: 'expanded' });
  });
  expect(mockDynamic).toHaveBeenCalledTimes(1);
  expect(inputs[0]['text2-1']).toBe('乙');
  await act(async () => {
    resolve(true);
    await controller.whenInputsSettled();
  });
  await waitFor(() => expect(controller.getBinding(0, 1, target)).toBeDefined());
  expect(mockDynamic.mock.calls.at(-1)![0].input).toEqual({
    'text1-1': '甲',
    'text2-1': '丙',
    items: 'expanded',
  });
  expect(mockRenderers.get('text2-1')!.textFlow).toBeDefined();
  act(() => {
    mockRenderers
      .get('text1-1')!
      .textFlow!.commitEdit({ value: 'あい', selection: { anchor: 2, focus: 2 } });
  });
  expect(inputs[0]['text1-1']).toBe('甲');
  expect(inputs[0]['text2-1']).toBe('丙');
});

test('a late layout result from the previous input unit cannot replace the selected unit pages', async () => {
  const inputs = [
    { 'text1-1': '', 'text2-1': '', items: 'slow' },
    { 'text1-1': '', 'text2-1': '', items: 'expanded' },
  ];
  let resolveOld!: (value: Template) => void;
  mockDynamic.mockImplementation(({ input }) =>
    input.items === 'slow'
      ? new Promise<Template>((done) => {
          resolveOld = done;
        })
      : Promise.resolve(expanded),
  );
  const controller = new TextFlowController(
    () => template,
    inputs,
    () => ({ enabled: true }),
    () => {},
  );
  const result = render(
    <Preview
      template={template}
      inputs={inputs}
      size={{ width: 500, height: 500 }}
      textFlowController={controller}
      onChangeInput={() => {}}
    />,
  );
  await waitFor(() => expect(mockDynamic).toHaveBeenCalledTimes(1));
  act(() => {
    result.getByText('next unit').click();
  });
  await waitFor(() => expect(controller.getBinding(1, 1, target)).toBeDefined());
  await act(async () => {
    resolveOld(template);
    await Promise.resolve();
  });
  expect(controller.getBinding(1, 1, target)).toBeDefined();
  expect(controller.getBinding(1, 0, target)).toBeUndefined();
});

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { BLANK_PDF, type SchemaForUI, type Template } from '@pdfme/common';
import * as converter from '@pdfme/converter';
import * as helper from '../src/helper';
import { useInitEvents, useScrollPageCursor, useUIPreProcessor } from '../src/hooks';

jest.mock('@pdfme/converter', () => ({
  pdf2size: jest.fn(),
  pdf2img: jest.fn(),
}));

const renderHook = <T,>(hook: () => T) => {
  const result = { current: undefined as T };
  const TestComponent = () => {
    result.current = hook();
    return null;
  };
  const rendered = render(<TestComponent />);
  return { result, ...rendered };
};

beforeEach(() => {
  (URL.createObjectURL as jest.Mock).mockClear();
  (URL.revokeObjectURL as jest.Mock).mockClear();
});

const createTemplate = (): Template => ({
  basePdf: 'data:application/pdf;base64,AA==',
  schemas: [[]],
});

test('useUIPreProcessor stores converter failures without unhandled rejections', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const pdf2sizeMock = converter.pdf2size as jest.MockedFunction<typeof converter.pdf2size>;
  const pdf2imgMock = converter.pdf2img as jest.MockedFunction<typeof converter.pdf2img>;
  const template = createTemplate();
  const size = { width: 1200, height: 1200 };

  pdf2sizeMock.mockRejectedValue(new Error('corrupt basePdf'));

  const { result } = renderHook(() =>
    useUIPreProcessor({
      template,
      size,
      zoomLevel: 1,
      maxZoom: 1,
    }),
  );

  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

  expect(result.current.error?.message).toContain('corrupt basePdf');
  expect(pdf2imgMock).toHaveBeenCalledTimes(1);
});

test('useUIPreProcessor runs pdf sizing and imaging in parallel with isolated buffers', async () => {
  const pdf2sizeMock = converter.pdf2size as jest.MockedFunction<typeof converter.pdf2size>;
  const pdf2imgMock = converter.pdf2img as jest.MockedFunction<typeof converter.pdf2img>;
  const template = createTemplate();
  const size = { width: 1200, height: 1200 };

  let resolvePdf2size!: (value: Array<{ width: number; height: number }>) => void;
  const pdf2sizePromise = new Promise<Array<{ width: number; height: number }>>((resolve) => {
    resolvePdf2size = resolve;
  });
  pdf2sizeMock.mockImplementation(() => pdf2sizePromise);
  pdf2imgMock.mockResolvedValueOnce([new Uint8Array([137, 80, 78, 71]).buffer]);

  const { result, unmount } = renderHook(() =>
    useUIPreProcessor({
      template,
      size,
      zoomLevel: 1,
      maxZoom: 1,
    }),
  );

  await waitFor(() => expect(pdf2imgMock).toHaveBeenCalled());

  expect(pdf2sizeMock).toHaveBeenCalled();
  expect(pdf2sizeMock.mock.calls[0][0]).not.toBe(pdf2imgMock.mock.calls[0][0]);

  resolvePdf2size([{ width: 210, height: 297 }]);

  await waitFor(() => expect(result.current.pageSizes).toEqual([{ width: 210, height: 297 }]));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(result.current.backgrounds).toEqual(['blob:pdfme-test']);

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdfme-test');
});

test('useScrollPageCursor does not mix the container viewport offset into scroll thresholds', () => {
  let scrollListener: EventListener | undefined;
  const canvas = {
    scrollTop: 461,
    addEventListener: jest.fn((type: string, listener: EventListener) => {
      if (type === 'scroll') scrollListener = listener;
    }),
    removeEventListener: jest.fn(),
    getBoundingClientRect: jest.fn(() => ({ top: 500 })),
  } as unknown as HTMLDivElement;
  const ref = { current: canvas } as React.RefObject<HTMLDivElement>;
  const onChangePageCursor = jest.fn();

  renderHook(() =>
    useScrollPageCursor({
      ref,
      pageSizes: [
        { width: 210, height: 297 },
        { width: 210, height: 297 },
      ],
      scale: 0.4,
      pageCursor: 1,
      onChangePageCursor,
    }),
  );

  expect(scrollListener).toBeDefined();
  act(() => scrollListener!(new Event('scroll')));

  expect(onChangePageCursor).not.toHaveBeenCalled();
});

test('useInitEvents paste ignores missing DOM nodes instead of storing null active elements', () => {
  jest.useFakeTimers();

  const schema = {
    id: 'field-1',
    name: 'field1',
    type: 'text',
    content: 'value',
    position: { x: 0, y: 0 },
    width: 100,
    height: 20,
  } as SchemaForUI;
  const activeElement = document.createElement('div');
  activeElement.id = schema.id;
  const template: Template = {
    basePdf: BLANK_PDF,
    schemas: [[schema]],
  };
  const pageSizes = [{ width: 210, height: 297 }];
  const schemasList = [[schema]];
  const changeSchemas = jest.fn();
  const commitSchemas = jest.fn();
  const removeSchemas = jest.fn();
  const onSaveTemplate = jest.fn();
  const setSchemasList = jest.fn();
  const onEdit = jest.fn();
  const onEditEnd = jest.fn();
  const past = { current: [] as SchemaForUI[][] };
  const future = { current: [] as SchemaForUI[][] };

  let shortcuts:
    | Parameters<typeof helper.initShortCuts>[0]
    | undefined;

  jest.spyOn(helper, 'initShortCuts').mockImplementation((arg) => {
    shortcuts = arg;
  });
  jest.spyOn(helper, 'destroyShortCuts').mockImplementation(() => undefined);
  jest.spyOn(helper, 'uuid').mockReturnValue('pasted-field');
  jest.spyOn(document, 'getElementById').mockReturnValue(null);

  renderHook(() =>
    useInitEvents({
      pageCursor: 0,
      pageSizes,
      activeElements: [activeElement],
      template,
      schemasList,
      changeSchemas,
      commitSchemas,
      removeSchemas,
      onSaveTemplate,
      past,
      future,
      setSchemasList,
      onEdit,
      onEditEnd,
    }),
  );

  expect(shortcuts).toBeDefined();

  act(() => {
    shortcuts!.copy();
    shortcuts!.paste();
    jest.runAllTimers();
  });

  expect(commitSchemas).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledWith([]);

  jest.useRealTimers();
});

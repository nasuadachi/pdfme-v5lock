import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { OptionsContext, PluginsRegistry } from '../../src/contexts';
import { pluginRegistry } from '@pdfme/common';
import Preview from '../../src/components/Preview';
import { TextFlowController } from '../../src/textFlow';
import type {
  Schema,
  SchemaForUI,
  Template,
  TextFlowBinding,
  TextFlowSelection,
} from '@pdfme/common';

const {
  bindTextFlowEditor: mockBindEditor,
  setTextFlowSelection,
  readTextFlowSelection,
} = jest.requireActual<{
  bindTextFlowEditor: (element: HTMLDivElement, binding: TextFlowBinding) => () => void;
  setTextFlowSelection: (element: HTMLElement, selection: TextFlowSelection) => void;
  readTextFlowSelection: (element: HTMLElement) => TextFlowSelection;
}>('../../../schemas/src/text/textFlowEditor');

let mockScrolled: (page: number) => void;
jest.mock('../../src/hooks', () => ({
  useUIPreProcessor: () => ({
    backgrounds: [],
    pageSizes: [
      { width: 100, height: 200 },
      { width: 100, height: 200 },
      { width: 100, height: 200 },
    ],
    scale: 1,
    error: null,
    refresh: async () => {},
  }),
  useScrollPageCursor: ({ onChangePageCursor }: { onChangePageCursor: (page: number) => void }) => {
    mockScrolled = onChangePageCursor;
  },
}));
jest.mock('@pdfme/common', () => ({
  ...jest.requireActual('@pdfme/common'),
  getDynamicTemplate: async ({ template }: { template: Template }) => template,
}));
jest.mock('../../src/helper', () => ({
  useMaxZoom: () => 1,
  getPagesScrollTopByIndex: (_sizes: unknown, page: number) => page * 1000,
  template2SchemasList: async (template: Template) =>
    template.schemas.map((page, i) =>
      page.map((schema) => ({ ...schema, id: `${i}-${schema.name}` })),
    ),
}));
jest.mock('../../src/components/Root', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../../src/components/StaticSchema', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/components/UnitPager', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/components/CtlBar', () => ({
  __esModule: true,
  default: ({
    pageCursor,
    setPageCursor,
  }: {
    pageCursor: number;
    setPageCursor: (page: number) => void;
  }) => (
    <>
      <output data-testid="page">{pageCursor + 1}</output>
      {[0, 1, 2].map((page) => (
        <button key={page} onClick={() => setPageCursor(page)}>
          page {page + 1}
        </button>
      ))}
    </>
  ),
}));
jest.mock('../../src/components/Paper', () => ({
  __esModule: true,
  default: ({
    schemasList,
    renderSchema,
  }: {
    schemasList: SchemaForUI[][];
    renderSchema: (arg: { schema: SchemaForUI; index: number }) => React.ReactNode;
  }) => (
    <div>
      {schemasList.flatMap((page) =>
        page.map((schema, index) => (
          <React.Fragment key={schema.id}>{renderSchema({ schema, index })}</React.Fragment>
        )),
      )}
    </div>
  ),
}));

const names = ['text1-10', 'text2-10', 'text3-10'];
const full = 'あいうえおかきくけこ';
const caret = (offset: number) => ({ anchor: offset, focus: offset });
const setup = async (
  data: Record<string, string> = {},
  crossPage = true,
  save?: () => Promise<boolean>,
) => {
  const template: Template = {
    basePdf: { width: 100, height: 200, padding: [0, 0, 0, 0] },
    schemas: names.map((name) => [
      { name, type: 'text', width: 80, height: 10, position: { x: 10, y: 10 } } as Schema,
    ]),
  };
  const inputs = [{ ...data }];
  const commit = jest.fn((next: typeof inputs) => {
    inputs.splice(0, inputs.length, ...next);
  });
  const onProgress = jest.fn();
  const options = {
    textFlow: {
      enabled: true,
      crossPage,
      overflow: 'truncate' as const,
      onBeforeDiscard: save,
      onProgress,
    },
  };
  const controller = new TextFlowController(
    () => template,
    inputs,
    () => options.textFlow,
    commit,
  );
  const onPageChange = jest.fn();
  const plugins = pluginRegistry({
    text: {
      pdf: jest.fn(),
      propPanel: { schema: {}, defaultSchema: template.schemas[0][0] },
      ui: ({ schema, rootElement, textFlow }) => {
        const element = document.createElement('div');
        element.setAttribute('contenteditable', 'true');
        element.tabIndex = 0;
        element.dataset.testid = schema.name;
        rootElement.appendChild(element);
        if (textFlow) mockBindEditor(element, textFlow);
      },
    },
  });
  const view = render(
    <OptionsContext.Provider value={options}>
      <PluginsRegistry.Provider value={plugins}>
        <input data-testid="other" />
        <Preview
          template={template}
          inputs={inputs}
          size={{ width: 500, height: 400 }}
          textFlowController={controller}
          onChangeInput={() => {}}
          onPageChange={onPageChange}
        />
      </PluginsRegistry.Provider>
    </OptionsContext.Provider>,
  );
  await waitFor(() =>
    expect((view.getByTestId(names[0]) as HTMLElement).getAttribute('contenteditable')).toBe(
      'true',
    ),
  );
  const editors = names.map((name) => view.getByTestId(name) as HTMLDivElement);
  // Wait for the real controller binding to initialize the editor from saved inputs.
  await waitFor(() => expect(editors[0].textContent).toBe(data[names[0]] ?? ''));
  const select = (page: number, offset: number) => {
    editors[page].focus();
    setTextFlowSelection(editors[page], caret(offset));
  };
  const key = (key: string, extra: KeyboardEventInit = {}) => {
    fireEvent.keyDown(document.activeElement!, { key, ...extra });
  };
  const input = (value: string) => {
    const editor = document.activeElement as HTMLDivElement;
    editor.textContent = value;
    setTextFlowSelection(editor, caret(value.length));
    fireEvent.input(editor, { inputType: 'insertText' });
  };
  return {
    ...view,
    editors,
    controller,
    onPageChange,
    onProgress,
    commit,
    inputs,
    select,
    key,
    input,
    page: () => view.getByTestId('page').textContent,
  };
};

test('13 characters keep editor DOM and show the second page; 23 show the third', async () => {
  const f = await setup();
  act(() => {
    f.select(0, 0);
    f.input(full + 'さしす');
  });
  expect(f.page()).toBe('2');
  expect(document.activeElement).toBe(f.editors[1]);
  expect(f.editors[1].textContent).toBe('さしす');
  expect(f.onPageChange).toHaveBeenLastCalledWith({ currentPage: 1, totalPages: 3 });
  act(() => f.input(full + 'さしす'));
  expect(f.page()).toBe('3');
  expect(document.activeElement).toBe(f.editors[2]);
  names.forEach((name, index) => expect(f.getByTestId(name)).toBe(f.editors[index]));
});

test('Backspace, undo, and redo follow the actual caret in both page directions', async () => {
  const f = await setup({ [names[0]]: full, [names[1]]: 'さしす' });
  act(() => {
    f.getByText('page 2').click();
    f.select(1, 0);
    f.key('Backspace');
  });
  expect(f.page()).toBe('1');
  expect(document.activeElement).toBe(f.editors[0]);
  act(() => f.key('z', { ctrlKey: true }));
  expect(f.page()).toBe('2');
  expect(f.inputs[0][names[1]]).toBe('さしす');
  act(() => f.key('z', { ctrlKey: true, shiftKey: true }));
  expect(f.page()).toBe('1');
});

test('left and right arrows cross row boundaries without changing text or undo history', async () => {
  const f = await setup({ [names[0]]: full, [names[1]]: 'さしす' });
  const before = JSON.stringify(f.inputs);
  act(() => {
    f.select(0, 10);
    f.key('ArrowRight');
  });
  expect(f.page()).toBe('2');
  expect(readTextFlowSelection(f.editors[1])).toEqual(caret(0));
  act(() => f.key('ArrowLeft'));
  expect(f.page()).toBe('1');
  expect(readTextFlowSelection(f.editors[0])).toEqual(caret(10));
  expect(JSON.stringify(f.inputs)).toBe(before);
  expect(f.commit).not.toHaveBeenCalled();
  act(() => f.key('z', { ctrlKey: true }));
  expect(JSON.stringify(f.inputs)).toBe(before);
});

test('up and down preserve the horizontal column while crossing pages', async () => {
  const f = await setup({ [names[0]]: full, [names[1]]: 'さしす' });
  act(() => {
    f.select(0, 2);
    f.key('ArrowDown');
  });
  expect(f.page()).toBe('2');
  expect(readTextFlowSelection(f.editors[1])).toEqual(caret(2));
  act(() => f.key('ArrowUp'));
  expect(f.page()).toBe('1');
  expect(readTextFlowSelection(f.editors[0])).toEqual(caret(2));
  expect(f.commit).not.toHaveBeenCalled();
});

test('rapid forward/backward navigation cannot leave the page cursor on a stale page', async () => {
  const f = await setup({ [names[0]]: full });
  act(() => {
    f.select(0, 10);
    f.key('ArrowRight');
    f.key('ArrowLeft');
  });
  expect(f.page()).toBe('1');
  expect(f.onPageChange.mock.calls.map(([page]) => page.currentPage)).toEqual([1, 0]);
});

test('native scroll notification for an already followed page does not activate it twice', async () => {
  const f = await setup({ [names[0]]: full });
  act(() => {
    f.select(0, 10);
    f.key('ArrowRight');
    mockScrolled(1);
  });
  expect(f.page()).toBe('2');
  expect(f.onPageChange).toHaveBeenCalledTimes(1);
});

test('typing within a page and overflowing a full final page do not jump the view', async () => {
  const f = await setup({ [names[2]]: full });
  act(() => {
    f.select(0, 0);
    f.input('あいう');
  });
  expect(f.onPageChange).not.toHaveBeenCalled();
  act(() => {
    f.getByText('page 3').click();
    f.select(2, 10);
    f.input(full + 'さしす');
  });
  expect(f.page()).toBe('3');
  expect(f.editors[2].textContent).toBe(full);
  expect(f.onPageChange).toHaveBeenCalledTimes(1);
});

test.each([
  { shiftKey: true },
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { isComposing: true },
])('modified/IME arrows retain native behavior: %o', async (modifier) => {
  const f = await setup({ [names[0]]: full });
  act(() => {
    f.select(0, 10);
    f.key('ArrowRight', modifier);
    f.key('ArrowDown', modifier);
  });
  expect(f.page()).toBe('1');
  expect(document.activeElement).toBe(f.editors[0]);
  expect(f.commit).not.toHaveBeenCalled();
});

test('a selected range and document boundaries do not move to another row', async () => {
  const f = await setup({ [names[0]]: full });
  act(() => {
    f.select(0, 0);
    f.key('ArrowLeft');
    f.key('ArrowUp');
  });
  expect(f.page()).toBe('1');
  act(() => {
    setTextFlowSelection(f.editors[0], { anchor: 0, focus: 10 });
    f.key('ArrowRight');
    f.key('ArrowDown');
  });
  expect(document.activeElement).toBe(f.editors[0]);
  act(() => {
    f.getByText('page 3').click();
    f.select(2, 0);
    f.key('ArrowRight');
    f.key('ArrowDown');
  });
  expect(f.page()).toBe('3');
});

test('composition is distributed and followed only after compositionend', async () => {
  const f = await setup();
  act(() => {
    f.select(0, 0);
    fireEvent.compositionStart(f.editors[0]);
    f.input(full + 'さしす');
  });
  expect(f.page()).toBe('1');
  expect(f.commit).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.compositionEnd(f.editors[0]);
    await Promise.resolve();
  });
  expect(f.page()).toBe('2');
});

test('failed persistence restores text without stealing focus or the manually selected page', async () => {
  let finish!: (saved: boolean) => void;
  const f = await setup(
    Object.fromEntries(names.map((name) => [name, full])),
    true,
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    f.select(0, 10);
    f.input(full + 'さ');
  });
  expect(f.page()).toBe('2');
  act(() => {
    f.getByText('page 3').click();
    f.getByTestId('other').focus();
  });
  await act(async () => {
    finish(false);
    await f.controller.whenInputsSettled();
  });
  expect(f.page()).toBe('3');
  expect(document.activeElement).toBe(f.getByTestId('other'));
  names.forEach((name) => expect(f.inputs[0][name]).toBe(full));
});

test('page-local forms keep their existing page-local arrow behavior', async () => {
  const f = await setup({ [names[0]]: full }, false);
  act(() => {
    f.select(0, 10);
    f.key('ArrowRight');
    f.key('ArrowDown');
  });
  expect(f.page()).toBe('1');
  expect(f.onPageChange).not.toHaveBeenCalled();
});

test('a delayed successful save cannot replace the later caret destination or visible page', async () => {
  let finish!: (saved: boolean) => void;
  const f = await setup(
    Object.fromEntries(names.map((name) => [name, full])),
    true,
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    f.select(0, 10);
    f.input(full + 'さ');
    f.key('ArrowDown');
  });
  expect(f.page()).toBe('3');
  expect(f.onProgress).toHaveBeenLastCalledWith({ inputIndex: 0, pageIndex: 2, totalPages: 3 });
  await act(async () => {
    finish(true);
    await f.controller.whenInputsSettled();
  });
  expect(f.page()).toBe('3');
  expect(f.onProgress).toHaveBeenLastCalledWith({ inputIndex: 0, pageIndex: 2, totalPages: 3 });
});

test('a native selection spanning different fields is not mistaken for a collapsed caret', async () => {
  const f = await setup({ [names[0]]: full, [names[1]]: 'さしす' });
  const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
  act(() => {
    f.select(0, 0);
    window
      .getSelection()!
      .setBaseAndExtent(f.editors[0].firstChild!, 0, f.editors[1].firstChild!, 1);
    f.editors[0].dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(f.page()).toBe('1');
  expect(f.commit).not.toHaveBeenCalled();
});

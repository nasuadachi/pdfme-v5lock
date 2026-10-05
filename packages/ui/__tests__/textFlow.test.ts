import {
  BLANK_A4_PDF,
  type Schema,
  type Template,
  type TextFlowOptions,
  type TextFlowEditor,
  type TextFlowDiscardEvent,
} from '@pdfme/common';
import { TextFlowController } from '../src/textFlow';

const row = (name: string): Schema => ({
  name,
  type: 'text',
  position: { x: 0, y: 0 },
  width: 100,
  height: 10,
});
const names = ['text01-2', 'text002-2', 'text3-2', 'text04-2'];
const template = (count = 4): Template => ({
  basePdf: BLANK_A4_PDF,
  schemas: [names.slice(0, count).map(row)],
});
const selection = (offset: number) => ({ anchor: offset, focus: offset });
const make = (
  input: Record<string, string>,
  options: TextFlowOptions = { enabled: true },
  t = template(),
) => {
  let committed = [{ ...input }];
  const commit = jest.fn((inputs: Record<string, string>[]) => {
    committed = inputs;
  });
  const controller = new TextFlowController(
    () => t,
    committed,
    () => options,
    commit,
  );
  const binding = (name = names[0], page = 0) => controller.getBinding(0, page, row(name))!;
  return { controller, binding, commit, inputs: () => committed };
};
const fakeEditor = (composing = () => false): TextFlowEditor => ({
  setValue: jest.fn(),
  focusSelection: jest.fn(),
  readSelection: () => selection(0),
  isComposing: composing,
  element: document.createElement('div'),
});

test('commits every changed text row atomically and preserves metadata', () => {
  const f = make({
    [names[0]]: '',
    [names[1]]: '甲',
    [names[2]]: '乙',
    [names[3]]: '',
    '%staffSelect1%': '担当医',
    patientName: '患者',
  });
  const editor = fakeEditor();
  f.binding(names[1]).registerEditor(editor);
  f.binding().commitEdit({ value: 'あいうえ', selection: selection(4) });
  expect(f.commit).toHaveBeenCalledTimes(1);
  expect(f.inputs()[0]).toEqual({
    [names[0]]: 'あい',
    [names[1]]: 'うえ',
    [names[2]]: '甲',
    [names[3]]: '乙',
    '%staffSelect1%': '担当医',
    patientName: '患者',
  });
  expect(editor.focusSelection).toHaveBeenLastCalledWith(selection(2));
});

test('the edit alone overflowing rolls back without saving or committing', () => {
  const save = jest.fn();
  const notice = jest.fn();
  const f = make(
    { [names[0]]: 'あ', [names[1]]: '甲' },
    { enabled: true, onBeforeDiscard: save, onNotice: notice },
    template(2),
  );
  const editor = fakeEditor();
  f.binding().registerEditor(editor);
  f.binding().commitEdit({
    value: 'あいうえお',
    selection: selection(5),
    beforeSelection: selection(1),
  });
  expect(save).not.toHaveBeenCalled();
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.inputs()[0][names[0]]).toBe('あ');
  expect(editor.setValue).toHaveBeenLastCalledWith('あ', selection(1), false);
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ type: 'overflow' }));
});

test('an async pre-discard save receives the immutable old inputs; queued typing survives', async () => {
  let resolve!: (saved: boolean) => void;
  let snapshot!: TextFlowDiscardEvent;
  const save = jest.fn((event: TextFlowDiscardEvent) => {
    snapshot = event;
    return new Promise<boolean>((done) => {
      resolve = done;
    });
  });
  const before = { [names[0]]: 'あ', [names[1]]: '甲', [names[2]]: '乙', patientName: '患者' };
  const f = make(before, { enabled: true, onBeforeDiscard: save }, template(3));
  const editor = fakeEditor();
  f.binding(names[1]).registerEditor(editor);
  f.binding().commitEdit({ value: 'あいうえ', selection: selection(4) });
  expect(f.inputs()).toEqual([before]);
  expect(snapshot.beforeInputs).toEqual([before]);
  expect(Object.isFrozen(snapshot.beforeInputs[0])).toBe(true);
  f.binding(names[1]).commitEdit({ value: 'う', selection: selection(1) });
  f.controller.changeInput(0, 'patientName', '別の患者');
  expect(f.commit).not.toHaveBeenCalled();
  resolve(true);
  await f.controller.whenInputsSettled();
  expect(f.inputs()[0]).toEqual({
    [names[0]]: 'あい',
    [names[1]]: 'う',
    [names[2]]: '甲',
    patientName: '別の患者',
  });
  expect(f.commit).toHaveBeenCalledTimes(3);
  expect(save).toHaveBeenCalledTimes(1);
});

test('save failure cancels the provisional queue and restores all rows', async () => {
  let reject!: (error: Error) => void;
  const notice = jest.fn();
  const before = { [names[0]]: 'あ', [names[1]]: '甲', [names[2]]: '乙' };
  const f = make(
    before,
    {
      enabled: true,
      onNotice: notice,
      onBeforeDiscard: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    },
    template(3),
  );
  const editor = fakeEditor();
  f.binding().registerEditor(editor);
  f.binding().commitEdit({
    value: 'あいうえ',
    selection: selection(4),
    beforeSelection: selection(1),
  });
  f.binding(names[1]).commitEdit({ value: 'う', selection: selection(1) });
  reject(new Error('offline'));
  await f.controller.whenInputsSettled();
  expect(f.inputs()).toEqual([before]);
  expect(f.commit).not.toHaveBeenCalled();
  expect(editor.setValue).toHaveBeenLastCalledWith('あ', selection(1), false);
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-failed' }));
});

test('a missing save hook fails closed', async () => {
  const before = { [names[0]]: 'あ', [names[1]]: '甲' };
  const f = make(before, { enabled: true }, template(2));
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  await f.controller.whenInputsSettled();
  expect(f.inputs()).toEqual([before]);
  expect(f.commit).not.toHaveBeenCalled();
});

test('failed body persistence preserves ordinary edits made during the wait', async () => {
  let reject!: (error: Error) => void;
  const before = {
    [names[0]]: 'あ',
    [names[1]]: '甲',
    patientName: '患者',
    '%staffSelect1%': '旧担当医',
  };
  const f = make(
    before,
    {
      enabled: true,
      onBeforeDiscard: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    },
    template(2),
  );
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  f.controller.changeInput(0, 'patientName', '更新した患者');
  f.controller.changeInput(0, '%staffSelect1%', '新担当医');
  reject(new Error('offline'));
  await f.controller.whenInputsSettled();
  expect(f.inputs()[0]).toEqual({
    ...before,
    patientName: '更新した患者',
    '%staffSelect1%': '新担当医',
  });
  expect(f.commit).toHaveBeenCalledTimes(1);
});

test('a live newline creates a blank continuation and deleting it pulls whole paragraphs up', () => {
  const f = make({ [names[0]]: 'あ', [names[1]]: '甲', [names[2]]: '乙', [names[3]]: '' });
  f.binding().commitEdit({ value: 'あ\n', selection: selection(2), preferNextRow: true });
  expect(f.inputs()[0]).toEqual({
    [names[0]]: 'あ',
    [names[1]]: '',
    [names[2]]: '甲',
    [names[3]]: '乙',
  });
  f.binding(names[1]).commitEdit({
    value: '',
    selection: selection(0),
    inputType: 'deleteContentBackward',
  });
  expect(f.inputs()[0]).toEqual({
    [names[0]]: 'あ',
    [names[1]]: '甲',
    [names[2]]: '乙',
    [names[3]]: '',
  });
});

test('a late unchanged final IME input does not take focus back from the distributed row', async () => {
  const f = make({ [names[0]]: '', [names[1]]: '' });
  const source = fakeEditor();
  const destination = fakeEditor();
  for (const editor of [source, destination]) {
    editor.element!.tabIndex = 0;
    document.body.appendChild(editor.element!);
    editor.focusSelection = () => editor.element!.focus();
  }
  try {
    f.binding().registerEditor(source);
    f.binding(names[1]).registerEditor(destination);
    source.element!.focus();
    f.binding().commitEdit({
      value: 'あいう',
      selection: selection(3),
      inputType: 'insertFromComposition',
    });
    await Promise.resolve();
    expect(document.activeElement).toBe(destination.element);
    f.binding().commitEdit({ value: 'あい', selection: selection(2), inputType: 'insertText' });
    expect(document.activeElement).toBe(destination.element);
    expect(f.inputs()[0][names[1]]).toBe('う');
    expect(f.commit).toHaveBeenCalledTimes(1);
  } finally {
    source.element!.remove();
    destination.element!.remove();
  }
});

test('an unchanged live newline still focuses its blank continuation when source is active', () => {
  const f = make({ [names[0]]: 'あ', [names[1]]: '' }, { enabled: true }, template(2));
  const source = fakeEditor();
  const destination = fakeEditor();
  for (const editor of [source, destination]) {
    editor.element!.tabIndex = 0;
    document.body.appendChild(editor.element!);
    editor.focusSelection = () => editor.element!.focus();
  }
  try {
    f.binding().registerEditor(source);
    f.binding(names[1]).registerEditor(destination);
    source.element!.focus();
    f.binding().commitEdit({ value: 'あ\n', selection: selection(2), preferNextRow: true });
    expect(document.activeElement).toBe(destination.element);
    expect(f.commit).not.toHaveBeenCalled();
  } finally {
    source.element!.remove();
    destination.element!.remove();
  }
});

test('failed pre-discard save preserves focus in an ordinary patient field', async () => {
  let reject!: (error: Error) => void;
  const before = { [names[0]]: 'あ', [names[1]]: '甲' };
  const f = make(
    before,
    {
      enabled: true,
      onBeforeDiscard: () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    },
    template(2),
  );
  const source = fakeEditor();
  const ordinary = document.createElement('input');
  source.element!.tabIndex = 0;
  document.body.append(source.element!, ordinary);
  source.focusSelection = () => source.element!.focus();
  try {
    f.binding().registerEditor(source);
    source.element!.focus();
    f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
    ordinary.focus();
    ordinary.value = '患者編集中';
    ordinary.setSelectionRange(2, 4);
    reject(new Error('offline'));
    await f.controller.whenInputsSettled();
    expect(document.activeElement).toBe(ordinary);
    expect([ordinary.selectionStart, ordinary.selectionEnd]).toEqual([2, 4]);
    expect(ordinary.value).toBe('患者編集中');
    expect(f.inputs()).toEqual([before]);
  } finally {
    source.element!.remove();
    ordinary.remove();
  }
});

test('a saved legacy paragraph retains its exemption while editing and moving', () => {
  const f = make({
    [names[0]]: 'あ',
    [names[1]]: '昔の長い\n文章',
    [names[2]]: '',
    [names[3]]: '',
  });
  expect(f.binding(names[1]).isLegacy).toBe(true);
  f.binding(names[1]).commitEdit({ value: '編集した長い\n文章', selection: selection(9) });
  expect(f.inputs()[0][names[1]]).toBe('編集した長い\n文章');
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.inputs()[0][names[2]]).toBe('編集した長い\n文章');
  expect(f.binding(names[2]).isLegacy).toBe(true);
});

test('flow undo and redo preserve unrelated later edits', () => {
  const f = make({ [names[0]]: '', [names[1]]: '', patientName: '患者' });
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  f.controller.changeInput(0, 'patientName', '更新した患者');
  f.binding().undo?.();
  expect(f.inputs()[0]).toEqual({ [names[0]]: '', [names[1]]: '', patientName: '更新した患者' });
  f.binding().redo?.();
  expect(f.inputs()[0][names[1]]).toBe('う');
  expect(f.inputs()[0].patientName).toBe('更新した患者');
});

test('page-local targets do not continue into another page', () => {
  const t = template(1);
  t.schemas.push([row('text2-2')]);
  const f = make({ [names[0]]: '', 'text2-2': '' }, { enabled: true }, t);
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.commit).not.toHaveBeenCalled();
});

test('an unchanged composing editor is untouched and never loses focus to another row', () => {
  const f = make({ [names[0]]: '', [names[1]]: '', [names[2]]: '' });
  let composing = false;
  const ime = fakeEditor(() => composing);
  const next = fakeEditor();
  f.binding(names[2]).registerEditor(ime);
  f.binding(names[1]).registerEditor(next);
  (ime.setValue as jest.Mock).mockClear();
  composing = true;
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  expect(ime.setValue).not.toHaveBeenCalled();
  expect(next.focusSelection).not.toHaveBeenCalled();
});

test('reset invalidates a late save completion', async () => {
  let resolve!: () => void;
  const f = make(
    { [names[0]]: 'あ', [names[1]]: '甲' },
    {
      enabled: true,
      onBeforeDiscard: () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    },
    template(2),
  );
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  f.controller.reset([{ [names[0]]: '新', [names[1]]: '' }]);
  resolve();
  await Promise.resolve();
  await f.controller.whenInputsSettled();
  expect(f.commit).not.toHaveBeenCalled();
});

test('a synchronous ordinary change in the save hook stays queued and survives failed persistence', async () => {
  let reject!: (error: Error) => void;
  const before = { [names[0]]: 'あ', [names[1]]: '甲', patientName: '患者' };
  const f = make(
    before,
    {
      enabled: true,
      onBeforeDiscard: () => {
        f.controller.changeInput(0, 'patientName', '更新患者');
        return new Promise<void>((_resolve, fail) => {
          reject = fail;
        });
      },
    },
    template(2),
  );
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.inputs()).toEqual([before]);
  reject(new Error('save-failed'));
  await f.controller.whenInputsSettled();
  expect(f.inputs()).toEqual([{ ...before, patientName: '更新患者' }]);
});

test('a synchronous undo in the save hook runs after the saved displacement', async () => {
  const before = { [names[0]]: 'あ', [names[1]]: '甲' };
  const f = make(
    before,
    {
      enabled: true,
      onBeforeDiscard: () => {
        f.controller.undo();
        return true;
      },
    },
    template(2),
  );
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.commit).not.toHaveBeenCalled();
  await f.controller.whenInputsSettled();
  expect(f.inputs()).toEqual([before]);
  expect(f.commit).toHaveBeenCalledTimes(2);
});

test('displayed pages replace original groups, invalidate old bindings, and preserve unchanged groups', () => {
  const f = make({ [names[0]]: '', [names[1]]: '', [names[2]]: '', [names[3]]: '' });
  const originalBinding = f.binding();
  f.controller.setDisplayedSchemas(0, template().schemas);
  expect(f.binding()).toBe(originalBinding);
  f.controller.setDisplayedSchemas(0, [[row(names[0])], names.slice(1).map(row)]);
  expect(f.binding(names[1], 1)).toBeDefined();
  expect(f.controller.getBinding(0, 0, row(names[1]))).toBeUndefined();
  originalBinding.commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.commit).not.toHaveBeenCalled();
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.commit).not.toHaveBeenCalled();
  f.binding(names[1], 1).commitEdit({ value: 'あいう', selection: selection(3) });
  expect(f.inputs()[0][names[1]]).toBe('あい');
  expect(f.inputs()[0][names[2]]).toBe('う');
});

test('undo/redo resolve their cursor field on its current displayed page', () => {
  const f = make({ [names[0]]: '', [names[1]]: '', [names[2]]: '', [names[3]]: '' });
  const oldDestination = fakeEditor();
  f.binding(names[1]).registerEditor(oldDestination);
  f.binding().commitEdit({ value: 'あいう', selection: selection(3) });
  (oldDestination.focusSelection as jest.Mock).mockClear();
  f.controller.setDisplayedSchemas(0, [[row(names[0])], names.slice(1).map(row)]);
  const newDestination = fakeEditor();
  f.binding(names[1], 1).registerEditor(newDestination);
  f.controller.undo();
  f.controller.redo();
  expect(newDestination.focusSelection).toHaveBeenLastCalledWith(selection(1));
  expect(oldDestination.focusSelection).not.toHaveBeenCalled();
});

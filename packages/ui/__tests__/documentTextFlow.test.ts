import {
  BLANK_A4_PDF,
  type Schema,
  type Template,
  type TextFlowOptions,
  type TextFlowBinding,
  type TextFlowSelection,
} from '@pdfme/common';
import { TextFlowController } from '../src/textFlow';
const { bindTextFlowEditor, setTextFlowSelection } = jest.requireActual<{
  bindTextFlowEditor: (element: HTMLDivElement, binding: TextFlowBinding) => () => void;
  setTextFlowSelection: (element: HTMLElement, selection: TextFlowSelection) => void;
}>('../../schemas/src/text/textFlowEditor');

const row = (name: string): Schema => ({
  name,
  type: 'text',
  position: { x: 0, y: 0 },
  width: 100,
  height: 10,
});
const selection = (offset: number) => ({ anchor: offset, focus: offset });
const make = (
  input: Record<string, string> = {},
  options: Partial<TextFlowOptions> = {},
  pages = [['text1-2'], ['text2-2'], ['text3-2']],
) => {
  let inputs = [{ ...input }];
  const notice = jest.fn();
  const progress = jest.fn();
  const commit = jest.fn((next: typeof inputs) => {
    inputs = next;
  });
  const template: Template = { basePdf: BLANK_A4_PDF, schemas: pages.map((page) => page.map(row)) };
  const controller = new TextFlowController(
    () => template,
    inputs,
    () => ({
      enabled: true,
      crossPage: true,
      overflow: 'truncate',
      onNotice: notice,
      onProgress: progress,
      ...options,
    }),
    commit,
  );
  const binding = (name = pages[0][0], page = 0) => controller.getBinding(0, page, row(name))!;
  const edit = (value: string, name = pages[0][0], page = 0) =>
    binding(name, page).commitEdit({ value, selection: selection(value.length) });
  return { controller, binding, edit, notice, progress, commit, inputs: () => inputs, template };
};

test('one utterance fills three pages and retains only its excess for recovery', () => {
  const f = make({ patientName: '固定' });
  f.edit('あいうえおかきく');
  expect(f.inputs()[0]).toMatchObject({
    'text1-2': 'あい',
    'text2-2': 'うえ',
    'text3-2': 'おか',
    patientName: '固定',
  });
  expect(f.notice).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'truncated', overflowText: 'きく' }),
  );
  expect(f.progress).toHaveBeenLastCalledWith({ inputIndex: 0, pageIndex: 2, totalPages: 3 });
  f.binding().undo!();
  expect(f.inputs()[0]['text1-2']).toBeUndefined();
  f.binding().redo!();
  expect(f.inputs()[0]['text3-2']).toBe('おか');
  expect(f.notice).toHaveBeenCalledTimes(1);
});

test('further dictation at the full last row preserves recorded text and reports every new tail', () => {
  const f = make({ 'text1-2': 'あい', 'text2-2': 'うえ', 'text3-2': 'おか' });
  f.edit('おかき', 'text3-2', 2);
  f.edit('おかく', 'text3-2', 2);
  expect(f.inputs()[0]['text3-2']).toBe('おか');
  expect(f.notice.mock.calls.map(([event]) => event.overflowText)).toEqual(['き', 'く']);
});

test('continuous native dictation moves to next-page editors without replacing their DOM', () => {
  const f = make();
  const elements = ['text1-2', 'text2-2', 'text3-2'].map((name, page) => {
    const element = document.createElement('div');
    element.contentEditable = 'true';
    element.tabIndex = 0;
    document.body.appendChild(element);
    bindTextFlowEditor(element, f.binding(name, page));
    return element;
  });
  const dictate = (value: string) => {
    const element = document.activeElement as HTMLDivElement;
    element.textContent = value;
    setTextFlowSelection(element, selection(value.length));
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
  };
  elements[0].focus();
  dictate('あいう');
  expect(document.activeElement).toBe(elements[1]);
  dictate('うえお');
  expect(document.activeElement).toBe(elements[2]);
  dictate('おかきく');
  expect(document.activeElement).toBe(elements[2]);
  expect(elements.map((element) => element.textContent)).toEqual(['あい', 'うえ', 'おか']);
  expect(f.inputs()[0]['text3-2']).toBe('おか');
  elements.forEach((element) => element.remove());
});

test('Japanese composition completes before cross-page distribution and truncation', async () => {
  const f = make();
  const element = document.createElement('div');
  element.contentEditable = 'true';
  element.tabIndex = 0;
  document.body.appendChild(element);
  bindTextFlowEditor(element, f.binding());
  element.focus();
  element.dispatchEvent(new CompositionEvent('compositionstart'));
  element.textContent = 'あいうえおかき';
  setTextFlowSelection(element, selection(7));
  element.dispatchEvent(new InputEvent('input', { isComposing: true }));
  expect(f.commit).not.toHaveBeenCalled();
  element.dispatchEvent(new CompositionEvent('compositionend'));
  await Promise.resolve();
  expect(f.inputs()[0]['text3-2']).toBe('おか');
  expect(f.notice).toHaveBeenCalledWith(expect.objectContaining({ overflowText: 'き' }));
  element.remove();
});

test('duplicate row numbers across pages disable document flow instead of overwriting a field', () => {
  const f = make({}, {}, [['text1-2'], ['text01-3']]);
  expect(f.binding()).toBeUndefined();
  expect(f.notice).toHaveBeenCalledWith(expect.objectContaining({ type: 'invalid-configuration' }));
  expect(f.commit).not.toHaveBeenCalled();
});

test('existing page-local soft wraps reflow correctly after opting into document flow', () => {
  const key = JSON.stringify([
    ['text1-2', 2],
    ['text2-2', 2],
  ]);
  const f = make(
    {
      'text1-2': 'あい',
      'text2-2': 'うえ',
      __pdfme_text_flow_soft_after: JSON.stringify({ [key]: [0] }),
    },
    {},
    [['text1-2', 'text2-2'], ['text3-2']],
  );
  f.edit('あ');
  expect(f.inputs()[0]).toMatchObject({ 'text1-2': 'あう', 'text2-2': 'え', 'text3-2': '' });
});

test('inserting before existing text still waits for a durable backup and restores on failure', async () => {
  let finish!: (saved: boolean) => void;
  const save = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const f = make({ 'text3-2': '既存' }, { onBeforeDiscard: save });
  f.edit('あいうえ既存', 'text3-2', 2);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]).toBeDefined();
  expect(f.inputs()[0]['text3-2']).toBe('既存');
  finish(false);
  await f.controller.whenInputsSettled();
  expect(f.inputs()[0]['text3-2']).toBe('既存');
  expect(f.notice).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-failed' }));
});

test('dynamic pages keep their current targets and complete before saving', async () => {
  const f = make({}, {}, [['text1-2', 'text2-2', 'text3-2']]);
  f.controller.setDisplayedSchemas(0, [[row('text1-2')], [], [row('text2-2'), row('text3-2')]]);
  f.edit('あいうえお');
  await f.controller.whenInputsSettled();
  expect(f.inputs()[0]).toMatchObject({ 'text1-2': 'あい', 'text2-2': 'うえ', 'text3-2': 'お' });
  expect(f.progress).toHaveBeenLastCalledWith({ inputIndex: 0, pageIndex: 2, totalPages: 3 });
});

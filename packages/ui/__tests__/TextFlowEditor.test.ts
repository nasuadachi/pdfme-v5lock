import {
  BLANK_A4_PDF,
  countTextFlowWidth,
  type Schema,
  type TextFlowBinding,
  type TextFlowSelection,
} from '@pdfme/common';
import { TextFlowController } from '../src/textFlow';

// Load the real editor without adding another package's source to UI's declaration build.
const { bindTextFlowEditor, readTextFlowText, readTextFlowSelection, setTextFlowSelection } =
  jest.requireActual<{
    bindTextFlowEditor: (element: HTMLDivElement, binding: TextFlowBinding) => () => void;
    readTextFlowText: (root: Node) => string;
    readTextFlowSelection: (element: HTMLElement) => TextFlowSelection;
    setTextFlowSelection: (element: HTMLElement, selection: TextFlowSelection) => void;
  }>('../../schemas/src/text/textFlowEditor');

const exactTwenty = 'だけです。あうあうあーついかついかついか';
const appended = 'あうあうあーついかついかついか追加追加';
const cleanups: Array<() => void> = [];
const caret = (offset: number) => ({ anchor: offset, focus: offset });

const make = (value: string) => {
  const schemas: Schema[] = Array.from({ length: 16 }, (_, index) => ({
    name: `text${String(index + 1).padStart(2, '0')}`,
    type: 'text',
    position: { x: 0, y: index * 6 },
    width: 100,
    height: 5,
  }));
  let inputs: Record<string, string>[] = [
    {
      ...Object.fromEntries(schemas.map(({ name }) => [name, name === 'text06' ? value : ''])),
      patientName: '患者名を保持',
      '%staffSelect6%': '担当医を保持',
    },
  ];
  const commit = jest.fn((next: Record<string, string>[]) => {
    inputs = next;
  });
  const controller = new TextFlowController(
    () => ({ basePdf: BLANK_A4_PDF, schemas: [schemas] }),
    inputs,
    () => ({ enabled: true }),
    commit,
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  const unbind: Array<() => void> = [];
  const bindings: TextFlowBinding[] = [];
  const elements = schemas.map((schema) => {
    const element = document.createElement('div');
    element.contentEditable = 'plaintext-only';
    element.tabIndex = 0;
    container.appendChild(element);
    const binding = controller.getBinding(0, 0, schema)!;
    bindings.push(binding);
    unbind.push(bindTextFlowEditor(element, binding));
    return element;
  });
  const source = elements[5];
  const next = elements[6];
  source.focus();
  setTextFlowSelection(source, caret(value.length));
  cleanups.push(() => {
    unbind.forEach((dispose) => dispose());
    controller.dispose();
    container.remove();
  });
  return {
    source,
    next,
    elements,
    sourceBinding: bindings[5],
    commit,
    inputs: () => inputs[0],
    expectSynchronized: () => {
      schemas.forEach(({ name }, index) => {
        expect(readTextFlowText(elements[index])).toBe(inputs[0][name]);
        if (!bindings[index].isLegacy) {
          expect(countTextFlowWidth(readTextFlowText(elements[index]))).toBeLessThanOrEqual(20);
        }
      });
      expect(inputs[0].patientName).toBe('患者名を保持');
      expect(inputs[0]['%staffSelect6%']).toBe('担当医を保持');
    },
  };
};

const input = (element: HTMLDivElement, value: string, isComposing = false) => {
  const inputType = isComposing ? 'insertCompositionText' : 'insertText';
  element.dispatchEvent(
    new InputEvent('beforeinput', { inputType, isComposing, cancelable: true }),
  );
  element.textContent = value;
  setTextFlowSelection(element, caret(value.length));
  element.dispatchEvent(new InputEvent('input', { inputType, isComposing }));
};

const paste = (element: HTMLDivElement, value: string) => {
  const event = new Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/plain'], getData: () => value },
  });
  element.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
};

afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
});

test('normal input after a full row normalizes its native DOM even when its committed prefix is unchanged', () => {
  const f = make(exactTwenty);
  expect(countTextFlowWidth(exactTwenty)).toBe(20);
  expect(f.sourceBinding.isLegacy).toBe(false);

  input(f.source, exactTwenty + '追加');

  expect(f.inputs().text06).toBe(exactTwenty);
  expect(f.inputs().text07).toBe('追加');
  f.expectSynchronized();
  expect(document.activeElement).toBe(f.next);
  expect(readTextFlowSelection(f.next)).toEqual(caret(2));
  expect(f.commit).toHaveBeenCalledTimes(1);
});

test('IME keeps its draft and focus until confirmation, then normalizes a full source row before moving', async () => {
  const f = make(exactTwenty);
  f.source.dispatchEvent(new CompositionEvent('compositionstart'));
  input(f.source, exactTwenty + '追加', true);

  expect(readTextFlowText(f.source)).toBe(exactTwenty + '追加');
  expect(f.inputs().text06).toBe(exactTwenty);
  expect(f.inputs().text07).toBe('');
  expect(document.activeElement).toBe(f.source);
  expect(f.commit).not.toHaveBeenCalled();
  f.source.dispatchEvent(new CompositionEvent('compositionend'));
  expect(document.activeElement).toBe(f.source);
  await Promise.resolve();

  expect(f.inputs().text06).toBe(exactTwenty);
  expect(f.inputs().text07).toBe('追加');
  f.expectSynchronized();
  expect(document.activeElement).toBe(f.next);
  expect(readTextFlowSelection(f.next)).toEqual(caret(2));
  expect(f.commit).toHaveBeenCalledTimes(1);
});

test('plain paste into an already full row also restores the unchanged source prefix', () => {
  const f = make(exactTwenty);

  paste(f.source, '追加');

  expect(f.inputs().text06).toBe(exactTwenty);
  expect(f.inputs().text07).toBe('追加');
  f.expectSynchronized();
  expect(document.activeElement).toBe(f.next);
  expect(readTextFlowSelection(f.next)).toEqual(caret(2));
});

test('typing Japanese text character by character from a short saved row matches a single paste', () => {
  const typed = make('だけです。');
  expect(typed.sourceBinding.isLegacy).toBe(false);
  for (const character of appended) {
    const active = document.activeElement as HTMLDivElement;
    expect(typed.elements).toContain(active);
    input(active, readTextFlowText(active) + character);
  }
  typed.expectSynchronized();
  const pasted = make('だけです。');
  paste(pasted.source, appended);

  pasted.expectSynchronized();
  expect(typed.inputs()).toEqual(pasted.inputs());
  expect(typed.inputs().text06).toBe(exactTwenty);
  expect(typed.inputs().text07).toBe('追加追加');
});

test('a late unchanged native input normalizes its markup without stealing the next row caret or committing twice', async () => {
  const f = make(exactTwenty);
  f.source.dispatchEvent(new CompositionEvent('compositionstart'));
  input(f.source, exactTwenty + '追加', true);
  f.source.dispatchEvent(new CompositionEvent('compositionend'));
  await Promise.resolve();
  expect(document.activeElement).toBe(f.next);
  f.source.innerHTML = `<span>${exactTwenty}</span>`;

  f.source.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));

  f.expectSynchronized();
  expect(f.source.childElementCount).toBe(0);
  expect(document.activeElement).toBe(f.next);
  expect(readTextFlowSelection(f.next)).toEqual(caret(2));
  expect(f.inputs().text07).toBe('追加');
  expect(f.inputs().text08).toBe('');
  expect(f.commit).toHaveBeenCalledTimes(1);
});

test('loaded overlimit or multiline legacy text remains in its field after confirmed editing', async () => {
  for (const value of ['長'.repeat(21), '保存済み\n本文']) {
    const f = make(value);
    expect(f.sourceBinding.isLegacy).toBe(true);
    f.source.dispatchEvent(new CompositionEvent('compositionstart'));
    input(f.source, value + '追加', true);
    f.source.dispatchEvent(new CompositionEvent('compositionend'));
    await Promise.resolve();

    expect(f.inputs().text06).toBe(value + '追加');
    expect(f.inputs().text07).toBe('');
    f.expectSynchronized();
    expect(f.sourceBinding.isLegacy).toBe(true);
    expect(document.activeElement).toBe(f.source);
    expect(readTextFlowSelection(f.source)).toEqual(caret(value.length + 2));
  }
});

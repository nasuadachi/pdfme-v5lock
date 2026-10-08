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

const make = (value: string, otherValues: Record<string, string> = {}) => {
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
      ...otherValues,
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

test('plain vertical arrows move between adjacent single-line Text fields without editing', () => {
  const f = make('甲乙丙', { text05: '前', text07: '後' });
  const before = { ...f.inputs() };
  setTextFlowSelection(f.source, caret(2));

  const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
  f.source.dispatchEvent(up);
  expect(up.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(f.elements[4]);
  expect(readTextFlowSelection(f.elements[4])).toEqual(caret(1));

  const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.elements[4].dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(f.source);
  expect(readTextFlowSelection(f.source)).toEqual(caret(2));

  const next = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.source.dispatchEvent(next);
  expect(next.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(f.next);
  expect(readTextFlowSelection(f.next)).toEqual(caret(1));

  expect(f.inputs()).toEqual(before);
  expect(f.commit).not.toHaveBeenCalled();
  f.expectSynchronized();
});

test('repeated vertical arrows visit empty Text fields without removing or filling them', () => {
  const f = make('甲乙丙');
  const before = { ...f.inputs() };
  setTextFlowSelection(f.source, caret(2));

  for (const [from, to, key] of [
    [f.source, f.elements[6], 'ArrowDown'],
    [f.elements[6], f.elements[7], 'ArrowDown'],
    [f.elements[7], f.elements[6], 'ArrowUp'],
    [f.elements[6], f.source, 'ArrowUp'],
  ] as const) {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    from.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(to);
    if (to !== f.source) expect(readTextFlowSelection(to)).toEqual(caret(0));
  }
  expect(readTextFlowSelection(f.source)).toEqual(caret(2));

  expect(f.inputs()).toEqual(before);
  expect(f.commit).not.toHaveBeenCalled();
  f.expectSynchronized();
});

test('vertical arrows keep the full-width column across ASCII and emoji without splitting a surrogate pair', () => {
  const f = make('甲乙', { text07: 'ABCDE', text08: '😀A' });
  const before = { ...f.inputs() };
  setTextFlowSelection(f.source, caret(1));

  const ascii = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.source.dispatchEvent(ascii);
  expect(ascii.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(f.elements[6]);
  expect(readTextFlowSelection(f.elements[6])).toEqual(caret(2));

  const emoji = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.elements[6].dispatchEvent(emoji);
  expect(emoji.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(f.elements[7]);
  expect(readTextFlowSelection(f.elements[7])).toEqual(caret(2));
  expect(f.inputs()).toEqual(before);
  expect(f.commit).not.toHaveBeenCalled();
});

test('clicking an empty destination clears the remembered column before the next arrow', () => {
  const f = make('甲乙丙', { text08: '丁戊己' });
  setTextFlowSelection(f.source, caret(2));
  const first = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.source.dispatchEvent(first);
  expect(document.activeElement).toBe(f.elements[6]);
  expect(readTextFlowSelection(f.elements[6])).toEqual(caret(0));

  f.elements[6].dispatchEvent(new Event('pointerup'));
  const second = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.elements[6].dispatchEvent(second);
  expect(second.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(f.elements[7]);
  expect(readTextFlowSelection(f.elements[7])).toEqual(caret(0));
  expect(f.commit).not.toHaveBeenCalled();
});

test('ArrowDown stays native when the registered next Text editor is detached', () => {
  const f = make('甲乙');
  const before = { ...f.inputs() };
  setTextFlowSelection(f.source, caret(1));
  f.next.remove();

  const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
  f.source.dispatchEvent(down);

  expect(down.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(f.source);
  expect(readTextFlowSelection(f.source)).toEqual(caret(1));
  expect(f.inputs()).toEqual(before);
  expect(f.commit).not.toHaveBeenCalled();
});

test('vertical arrows keep the visible column when leaving and entering wrapped Text fields', () => {
  const f = make('ABCDEFGH', { text07: 'wxyz' });
  const before = { ...f.inputs() };
  const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: function (this: Range) {
      const value = this.startContainer.textContent;
      const offset = this.startOffset;
      if (value === 'ABCDEFGH') {
        const wrapped = offset >= 4;
        return [
          { top: wrapped ? 30 : 10, left: (wrapped ? offset - 4 : offset) * 5, height: 12 },
        ] as unknown as DOMRectList;
      }
      if (value === 'wxyz')
        return [{ top: 50, left: offset * 5, height: 12 }] as unknown as DOMRectList;
      return [] as unknown as DOMRectList;
    },
  });
  try {
    setTextFlowSelection(f.source, caret(6));
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    f.source.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(f.next);
    expect(readTextFlowSelection(f.next)).toEqual(caret(2));

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
    f.next.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(f.source);
    expect(readTextFlowSelection(f.source)).toEqual(caret(6));
    expect(f.inputs()).toEqual(before);
    expect(f.commit).not.toHaveBeenCalled();
  } finally {
    if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects);
    else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  }
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

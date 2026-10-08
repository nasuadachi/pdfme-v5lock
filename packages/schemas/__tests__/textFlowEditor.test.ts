/** @jest-environment jsdom */
import type { TextFlowBinding, TextFlowEditor } from '@pdfme/common';
import {
  bindTextFlowEditor,
  readTextFlowText,
  readTextFlowSelection,
  setTextFlowSelection,
} from '../src/text/textFlowEditor.js';

describe('flowing Text native editor', () => {
  let element: HTMLDivElement;
  let editor: TextFlowEditor;
  let commitEdit: jest.Mock;
  let undo: jest.Mock;
  let dispose: () => void;

  beforeEach(() => {
    element = document.createElement('div');
    element.contentEditable = 'true';
    element.tabIndex = 0;
    document.body.appendChild(element);
    element.focus();
    commitEdit = jest.fn();
    undo = jest.fn();
    const binding: TextFlowBinding = {
      isLegacy: false,
      registerEditor: (registered) => {
        editor = registered;
        return () => undefined;
      },
      commitEdit,
      undo,
    };
    dispose = bindTextFlowEditor(element, binding);
  });
  afterEach(() => {
    dispose();
    element.remove();
  });

  it('reads dictated newlines and browser block/filler markup without losing the last break', () => {
    element.innerHTML = 'A<div>B</div><div><br></div>';
    expect(readTextFlowText(element)).toBe('A\nB\n');
    element.textContent = 'A\n\nB\n';
    expect(readTextFlowText(element)).toBe('A\n\nB\n');
    element.innerHTML = 'A<div>B</div>C';
    expect(readTextFlowText(element)).toBe('A\nB\nC');
    element.innerHTML = 'A<div><br></div><div><br></div>';
    expect(readTextFlowText(element)).toBe('A\n\n');
    element.innerHTML = 'A<div><br></div>C';
    expect(readTextFlowText(element)).toBe('A\n\nC');
  });

  it('counts a caret at a block-to-text boundary using its original sibling context', () => {
    element.innerHTML = 'A<div>B</div>C';
    window.getSelection()!.setBaseAndExtent(element, 2, element, 2);
    expect(readTextFlowSelection(element)).toEqual({ anchor: 4, focus: 4 });
    window.getSelection()!.setBaseAndExtent(element.childNodes[1], 1, element.childNodes[1], 1);
    expect(readTextFlowSelection(element)).toEqual({ anchor: 3, focus: 3 });
  });

  it('treats a delete-all BR filler as empty while preserving an actual saved newline text node', () => {
    element.innerHTML = '<br>';
    expect(readTextFlowText(element)).toBe('');
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      cancelable: true,
    });
    element.dispatchEvent(event);
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({ value: '', allowDeletionPullUp: true }),
    );
    element.textContent = '\n';
    expect(readTextFlowText(element)).toBe('\n');
  });

  it('uses actual input text and not the Enter key to detect a dictated newline', () => {
    element.textContent = '音声\n';
    setTextFlowSelection(element, { anchor: 3, focus: 3 });
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({ value: '音声\n', preferNextRow: true }),
    );
  });

  it('recognizes Enter at the end of a row as a blank continuation', () => {
    element.innerHTML = 'だけです。<div><br></div>';
    const blank = element.lastChild!;
    window.getSelection()!.setBaseAndExtent(blank, 0, blank, 0);
    expect(readTextFlowText(element)).toBe('だけです。\n');
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertParagraph' }));
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'だけです。\n',
        selection: { anchor: 6, focus: 6 },
        preferNextRow: true,
      }),
    );
  });

  it('does not split or move focus during IME and commits once after final input', async () => {
    element.textContent = '前';
    setTextFlowSelection(element, { anchor: 1, focus: 1 });
    element.dispatchEvent(new CompositionEvent('compositionstart'));
    element.textContent = '前変換';
    element.dispatchEvent(
      new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }),
    );
    expect(commitEdit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element);
    element.dispatchEvent(new CompositionEvent('compositionend'));
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    await Promise.resolve();
    expect(commitEdit).toHaveBeenCalledTimes(1);
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({ value: '前変換', beforeSelection: { anchor: 1, focus: 1 } }),
    );
  });

  it('preserves backwards selection while receiving a value update', () => {
    element.textContent = 'abcdef';
    setTextFlowSelection(element, { anchor: 5, focus: 2 });
    editor.setValue('abcdefgh');
    expect(readTextFlowSelection(element)).toEqual({ anchor: 5, focus: 2 });
    expect(document.activeElement).toBe(element);
  });

  it('defers failed-save rollback DOM changes until IME completes and cancels that draft', async () => {
    element.textContent = '操作前';
    element.dispatchEvent(new CompositionEvent('compositionstart'));
    element.textContent = '操作前変換中';
    editor.setValue('操作前', { anchor: 3, focus: 3 });
    expect(element.textContent).toBe('操作前変換中');
    element.dispatchEvent(new CompositionEvent('compositionend'));
    await Promise.resolve();
    expect(element.textContent).toBe('操作前');
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it('replaces selected text with plain pasted multiline text without a continuation blank', () => {
    element.textContent = 'ABC';
    setTextFlowSelection(element, { anchor: 1, focus: 2 });
    const event = new Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'X\r\nY\n' } });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'AX\nY\nC',
        inputType: 'insertFromPaste',
        preferNextRow: false,
      }),
    );
  });

  it('does not erase a selection when a pasted image has no plain text', () => {
    element.textContent = 'ABC';
    setTextFlowSelection(element, { anchor: 1, focus: 2 });
    const event = new Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { types: ['image/png'], getData: () => '' },
    });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(element.textContent).toBe('ABC');
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it('retains the clicked caret for rollback when dictation provides input without beforeinput', () => {
    editor.setValue('ABC');
    setTextFlowSelection(element, { anchor: 1, focus: 1 });
    element.dispatchEvent(new Event('pointerup'));
    element.textContent = 'AXBC';
    setTextFlowSelection(element, { anchor: 2, focus: 2 });
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({ beforeSelection: { anchor: 1, focus: 1 } }),
    );
  });

  it('routes undo as a whole flow operation and never fires on blur', () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, cancelable: true }),
    );
    expect(undo).toHaveBeenCalledTimes(1);
    element.blur();
    expect(commitEdit).not.toHaveBeenCalled();
  });

  it('routes Backspace from a blank row even without a native input event', () => {
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      cancelable: true,
    });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '',
        inputType: 'deleteContentBackward',
        allowDeletionPullUp: true,
        deleteBackwardAtStart: true,
      }),
    );
  });

  it('still compacts a blank editor for other delete input types', () => {
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentForward',
      cancelable: true,
    });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: '',
        allowDeletionPullUp: true,
      }),
    );
    expect(commitEdit.mock.calls[0][0].deleteBackwardAtStart).toBeUndefined();
  });

  it('sends Backspace at a nonempty row start to the flow instead of native input', () => {
    editor.setValue('だけです');
    setTextFlowSelection(element, { anchor: 0, focus: 0 });
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(element.textContent).toBe('だけです');
    expect(commitEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'だけです',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );

    commitEdit.mockClear();
    setTextFlowSelection(element, { anchor: 1, focus: 1 });
    const middle = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      cancelable: true,
    });
    element.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
    expect(commitEdit).not.toHaveBeenCalled();
  });
});

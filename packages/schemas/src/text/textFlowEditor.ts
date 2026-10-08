import type { TextFlowBinding, TextFlowSelection } from '@pdfme/common';

/** Use original sibling context even when stopping at a caret boundary. */
const readTextFlowContent = (root: Node, endpoint?: { node: Node; offset: number }): string => {
  // A lone BR is the native empty-editor filler, not a stored newline text node.
  if (root.childNodes.length === 1 && (root.firstChild as Element)?.tagName === 'BR') return '';
  let text = '';
  let finished = false;
  const visit = (node: Node) => {
    if (finished) return;
    if (node.nodeType === 3) {
      if (endpoint?.node === node) {
        text += (node.textContent ?? '').slice(0, endpoint.offset);
        finished = true;
      } else text += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const element = node as Element;
    const block = element.tagName === 'DIV' || element.tagName === 'P';
    if (node !== root && block && node.previousSibling) text += '\n';
    if (endpoint?.node === node && endpoint.offset === 0) {
      finished = true;
      return;
    }
    if (element.tagName === 'BR') {
      text += '\n';
      return;
    }
    // An empty block's BR is the browser's caret placeholder. The block
    // boundary above already represents the explicit paragraph break.
    const filler =
      node !== root &&
      block &&
      node.childNodes.length === 1 &&
      (node.firstChild as Element)?.tagName === 'BR';
    if (filler) {
      if (endpoint?.node === node || endpoint?.node === node.firstChild) finished = true;
    } else {
      for (let index = 0; index < node.childNodes.length; index++) {
        if (endpoint?.node === node && endpoint.offset === index) {
          finished = true;
          break;
        }
        visit(node.childNodes[index]);
        if (finished) break;
      }
      if (endpoint?.node === node && endpoint.offset === node.childNodes.length) finished = true;
    }
    if (finished) return;
    if (
      node !== root &&
      block &&
      node.nextSibling &&
      !['DIV', 'P'].includes((node.nextSibling as Element).tagName)
    )
      text += '\n';
  };
  visit(root);
  return text.replace(/\r\n?|\n/g, '\n');
};

/** Read actual paragraph breaks, including a trailing dictated/typed newline. */
export const readTextFlowText = (root: Node): string => readTextFlowContent(root);

export const readTextFlowSelection = (element: HTMLElement): TextFlowSelection => {
  const selection = element.ownerDocument.defaultView?.getSelection();
  const length = readTextFlowText(element).length;
  if (
    !selection ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !element.contains(selection.anchorNode) ||
    !element.contains(selection.focusNode)
  ) {
    return { anchor: length, focus: length };
  }
  const offset = (node: Node, position: number) =>
    readTextFlowContent(element, { node, offset: position }).length;
  return {
    anchor: offset(selection.anchorNode, selection.anchorOffset),
    focus: offset(selection.focusNode, selection.focusOffset),
  };
};

export const setTextFlowSelection = (element: HTMLElement, position: TextFlowSelection) => {
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) return;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node);
  const locate = (wanted: number): [Node, number] => {
    let offset = Math.max(0, wanted);
    for (const textNode of nodes) {
      const length = textNode.textContent?.length ?? 0;
      if (offset <= length) return [textNode, offset];
      offset -= length;
    }
    return nodes.length
      ? [nodes[nodes.length - 1], nodes[nodes.length - 1].textContent?.length ?? 0]
      : [element, 0];
  };
  const [anchorNode, anchorOffset] = locate(position.anchor);
  const [focusNode, focusOffset] = locate(position.focus);
  selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
};

/** Bound only for opted-in Form text fields; ordinary Text keeps its blur behavior. */
export const bindTextFlowEditor = (
  element: HTMLDivElement,
  binding: TextFlowBinding,
  onValue?: (value: string, legacy: boolean) => void,
) => {
  let composing = false;
  let endingComposition = false;
  let beforeSelection = readTextFlowSelection(element);
  let canonicalText = readTextFlowText(element);
  let compositionSelection = beforeSelection;
  let deferredValue: { value: string; selection?: TextFlowSelection; legacy: boolean } | undefined;
  let ignoreBackwardBeforeInput = false;

  const updateValue = (value: string, selection?: TextFlowSelection, legacy = binding.isLegacy) => {
    if (composing || endingComposition) {
      // A failed async presave may restore the model while a later IME draft
      // is active. Finish the native composition before restoring its DOM.
      deferredValue = { value, selection, legacy };
      return;
    }
    const focused = element.ownerDocument.activeElement === element;
    const restore = selection ?? (focused ? readTextFlowSelection(element) : undefined);
    if (readTextFlowText(element) !== value || element.childElementCount > 0)
      element.textContent = value;
    onValue?.(value, legacy);
    canonicalText = value;
    if (focused && restore) {
      setTextFlowSelection(element, restore);
      beforeSelection = restore;
    }
  };
  const unregister = binding.registerEditor({
    element,
    setValue: updateValue,
    readSelection: () => readTextFlowSelection(element),
    focusSelection: (selection) => {
      element.focus({ preventScroll: true });
      setTextFlowSelection(element, selection);
      beforeSelection = selection;
    },
    isComposing: () => composing || endingComposition,
  });

  const commit = (inputType?: string, previousSelection = beforeSelection) => {
    const value = readTextFlowText(element);
    const selection = readTextFlowSelection(element);
    const preferNextRow =
      inputType !== 'insertFromPaste' &&
      value.endsWith('\n') &&
      selection.anchor === value.length &&
      selection.focus === value.length;
    void binding.commitEdit({
      value,
      selection,
      beforeSelection: previousSelection,
      inputType,
      preferNextRow,
    });
  };
  const deleteBackwardAtStart = (selection: TextFlowSelection) => {
    const value = readTextFlowText(element);
    void binding.commitEdit({
      value,
      selection,
      beforeSelection: selection,
      inputType: 'deleteContentBackward',
      deleteBackwardAtStart: true,
      allowDeletionPullUp: value === '' ? true : undefined,
    });
  };
  const beforeInput = (event: InputEvent) => {
    if (composing || event.isComposing) return;
    if (event.inputType === 'deleteContentBackward' && ignoreBackwardBeforeInput) {
      event.preventDefault();
      return;
    }
    beforeSelection = readTextFlowSelection(element);
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      event.preventDefault();
      if (event.inputType === 'historyUndo') binding.undo?.();
      else binding.redo?.();
    } else if (
      event.inputType === 'deleteContentBackward' &&
      beforeSelection.anchor === 0 &&
      beforeSelection.focus === 0
    ) {
      // The previous row belongs to a different contenteditable, so the browser
      // cannot delete its last character or emit a useful input event here.
      event.preventDefault();
      deleteBackwardAtStart(beforeSelection);
    } else if (event.inputType.startsWith('delete') && readTextFlowText(element) === '') {
      // An empty editor may not emit input for other delete operations either.
      event.preventDefault();
      void binding.commitEdit({
        value: '',
        selection: beforeSelection,
        beforeSelection,
        inputType: event.inputType,
        allowDeletionPullUp: true,
      });
    }
  };
  const input = (event: Event) => {
    const inputEvent = event as InputEvent;
    if (composing || endingComposition || inputEvent.isComposing) return;
    commit(inputEvent.inputType);
  };
  const compositionStart = () => {
    composing = true;
    compositionSelection = readTextFlowSelection(element);
  };
  const compositionEnd = () => {
    composing = false;
    endingComposition = true;
    // Safari and Chrome differ in whether final input precedes compositionend.
    // Read once after both events, without touching the active IME DOM.
    queueMicrotask(() => {
      endingComposition = false;
      if (!element.isConnected || composing) return;
      if (deferredValue) {
        const restored = deferredValue;
        deferredValue = undefined;
        updateValue(restored.value, restored.selection, restored.legacy);
        return;
      }
      commit('insertFromComposition', compositionSelection);
    });
  };
  const paste = (event: ClipboardEvent) => {
    if (composing || endingComposition) return;
    const types = Array.from(event.clipboardData?.types ?? []);
    if (types.length > 0 && !types.includes('text/plain') && !types.includes('text')) return;
    const pasted = event.clipboardData?.getData('text/plain');
    if (!pasted) return;
    event.preventDefault();
    const selection = readTextFlowSelection(element);
    beforeSelection = selection;
    const current = readTextFlowText(element);
    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    const normalized = pasted.replace(/\r\n?|\n/g, '\n');
    const next = current.slice(0, start) + normalized + current.slice(end);
    const caret = { anchor: start + normalized.length, focus: start + normalized.length };
    updateValue(next, caret);
    commit('insertFromPaste', selection);
  };
  const keyDown = (event: KeyboardEvent) => {
    if (composing || event.isComposing) return;
    if (event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const selection = readTextFlowSelection(element);
      if (selection.anchor === 0 && selection.focus === 0) {
        // Safari can send keydown without beforeinput when the caret is at the
        // start of this editor. Handle the key intent before the native no-op.
        event.preventDefault();
        beforeSelection = selection;
        ignoreBackwardBeforeInput = true;
        queueMicrotask(() => {
          ignoreBackwardBeforeInput = false;
        });
        deleteBackwardAtStart(selection);
      }
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) binding.redo?.();
      else binding.undo?.();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      binding.redo?.();
    }
  };
  const rememberSelection = () => {
    if (
      !composing &&
      !endingComposition &&
      element.ownerDocument.activeElement === element &&
      readTextFlowText(element) === canonicalText
    ) {
      beforeSelection = readTextFlowSelection(element);
    }
  };
  element.addEventListener('beforeinput', beforeInput);
  element.addEventListener('input', input);
  element.addEventListener('compositionstart', compositionStart);
  element.addEventListener('compositionend', compositionEnd);
  element.addEventListener('paste', paste);
  element.addEventListener('keydown', keyDown);
  element.addEventListener('focus', rememberSelection);
  element.addEventListener('pointerup', rememberSelection);
  element.addEventListener('keyup', rememberSelection);
  return () => {
    unregister();
    element.removeEventListener('beforeinput', beforeInput);
    element.removeEventListener('input', input);
    element.removeEventListener('compositionstart', compositionStart);
    element.removeEventListener('compositionend', compositionEnd);
    element.removeEventListener('paste', paste);
    element.removeEventListener('keydown', keyDown);
    element.removeEventListener('focus', rememberSelection);
    element.removeEventListener('pointerup', rememberSelection);
    element.removeEventListener('keyup', rememberSelection);
  };
};

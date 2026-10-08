import {
  countTextFlowWidth,
  distributeTextFlow,
  getTextFlowCaretOffsets,
  getTextFlowOffsetAtWidth,
  getTextFlowLegacyNames,
  getTextFlowTargets,
  type Schema,
  type Template,
  type TextFlowBinding,
  type TextFlowEditor,
  type TextFlowOptions,
  type TextFlowSelection,
} from '@pdfme/common';

type Inputs = Record<string, string>[];
type Snapshot = { inputs: Inputs; legacy: Set<string>[] };
type Focus = { inputIndex: number; pageIndex: number; name: string; selection: TextFlowSelection };
type History = { before: Snapshot; after: Snapshot; beforeFocus?: Focus; afterFocus?: Focus };
type Transaction = History & {
  id: string;
  inputIndex: number;
  pageIndex: number;
  sourceName: string;
  discarded: { name: string; value: string }[];
  undo: History[];
  redo: History[];
};

const copyInputs = (inputs: Inputs): Inputs => inputs.map((input) => ({ ...input }));
const copySnapshot = (state: Snapshot): Snapshot => ({
  inputs: copyInputs(state.inputs),
  legacy: state.legacy.map((names) => new Set(names)),
});
const editorKey = (inputIndex: number, pageIndex: number, name: string) =>
  JSON.stringify([inputIndex, pageIndex, name]);

/** Browser geometry keeps the same horizontal position across visibly wrapped rows. */
const caretRect = (
  element: HTMLElement | undefined,
  value: string,
  offset: number,
  boundaries = getTextFlowCaretOffsets(value),
) => {
  const node = element?.firstChild;
  if (
    !node ||
    element.childNodes.length !== 1 ||
    node.nodeType !== Node.TEXT_NODE ||
    node.textContent !== value
  )
    return undefined;
  const range = element.ownerDocument.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  let rect = range.getClientRects?.()[0];
  if (rect?.height) return { left: rect.left, top: rect.top };
  // WebKit can omit collapsed caret rectangles while returning glyph geometry.
  const next = boundaries.find((boundary) => boundary > offset);
  const previous = boundaries.filter((boundary) => boundary < offset).at(-1);
  if (next !== undefined) {
    range.setStart(node, offset);
    range.setEnd(node, next);
    rect = range.getClientRects?.()[0];
    return rect?.height ? { left: rect.left, top: rect.top } : undefined;
  }
  if (previous !== undefined) {
    range.setStart(node, previous);
    range.setEnd(node, offset);
    rect = range.getClientRects?.()[0];
    return rect?.height ? { left: rect.right, top: rect.top } : undefined;
  }
  return undefined;
};

const visualCaretOffset = (
  element: HTMLElement | undefined,
  value: string,
  direction: 'up' | 'down',
  wantedX: number | undefined,
): number | undefined => {
  if (!element || wantedX === undefined) return undefined;
  // Older inputs may keep arbitrarily long legacy text in one field.
  if (value.length > 200) return direction === 'up' ? value.length : 0;
  const left = element.getBoundingClientRect().left;
  const boundaries = getTextFlowCaretOffsets(value);
  const positions = boundaries.flatMap((offset) => {
    const rect = caretRect(element, value, offset, boundaries);
    return rect ? [{ offset, top: rect.top, x: rect.left - left }] : [];
  });
  const full = element.ownerDocument.createRange();
  full.selectNodeContents(
    element.firstChild?.nodeType === Node.TEXT_NODE ? element.firstChild : element,
  );
  const fullLines = Array.from(full.getClientRects?.() ?? []).filter((rect) => rect.height);
  if (!positions.length) {
    const wrapped = fullLines.some((rect) => Math.abs(rect.top - fullLines[0].top) > 1);
    return wrapped ? (direction === 'up' ? value.length : 0) : undefined;
  }
  const measured = [...positions, ...fullLines];
  const edgeTop = measured.reduce(
    (top, rect) => (direction === 'up' ? Math.max(top, rect.top) : Math.min(top, rect.top)),
    direction === 'up' ? -Infinity : Infinity,
  );
  const onEdge = positions.filter(({ top }) => Math.abs(top - edgeTop) <= 1);
  if (!onEdge.length) return direction === 'up' ? value.length : 0;
  return onEdge.reduce((best, current) =>
    Math.abs(current.x - wantedX) < Math.abs(best.x - wantedX) ? current : best,
  ).offset;
};

/** Keeps a provisional editor state separate from the publicly committed inputs.
 * In particular, a discard save observes an immutable BEFORE snapshot, even when
 * dictation has already added another edit to the live contenteditable element.
 */
export class TextFlowController {
  private state: Snapshot;
  private committed: Snapshot;
  private readonly bindings = new Map<string, TextFlowBinding>();
  private readonly editors = new Map<string, TextFlowEditor>();
  private readonly editorValues = new Map<string, { value: string; legacy: boolean }>();
  private readonly displayedSchemas = new Map<number, Schema[][]>();
  private readonly groupVersions = new Map<number, number>();
  private queue: Transaction[] = [];
  private draining?: Promise<void>;
  private epoch = 0;
  private sequence = 0;
  private undoHistory: History[] = [];
  private redoHistory: History[] = [];
  private committedUndo: History[] = [];
  private committedRedo: History[] = [];
  private invalidPages = new Set<number>();
  private legacyNotified = false;
  private verticalNavigation?: { key: string; offset: number; width: number; x?: number };

  constructor(
    private readonly getTemplate: () => Template,
    inputs: Inputs,
    private readonly getOptions: () => TextFlowOptions,
    private readonly commit: (inputs: Inputs) => void,
  ) {
    this.state = this.makeInitialState(inputs);
    this.committed = copySnapshot(this.state);
  }

  private makeInitialState(inputs: Inputs): Snapshot {
    const targets = this.getTemplate().schemas.flatMap((page) => getTextFlowTargets(page).targets);
    return {
      inputs: copyInputs(inputs),
      legacy: inputs.map((input) => new Set(getTextFlowLegacyNames(targets, input))),
    };
  }

  public reset(inputs: Inputs) {
    this.epoch += 1;
    this.queue = [];
    this.draining = undefined;
    this.state = this.makeInitialState(inputs);
    this.committed = copySnapshot(this.state);
    this.undoHistory = [];
    this.redoHistory = [];
    this.committedUndo = [];
    this.committedRedo = [];
    this.bindings.clear();
    this.invalidPages.clear();
    this.legacyNotified = false;
    this.verticalNavigation = undefined;
    this.syncEditors();
  }

  public dispose() {
    this.epoch += 1;
    this.queue = [];
    this.draining = undefined;
    this.editors.clear();
    this.editorValues.clear();
    this.bindings.clear();
    this.displayedSchemas.clear();
    this.groupVersions.clear();
    this.verticalNavigation = undefined;
  }

  public async whenInputsSettled(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /** Preview supplies the actual pages after tables have expanded or contracted. */
  public setDisplayedSchemas(inputIndex: number, schemas: Schema[][]) {
    const previous = this.getSchemas(inputIndex);
    const signature = (pages: Schema[][]) =>
      JSON.stringify(pages.map((page) => getTextFlowTargets(page)));
    this.displayedSchemas.set(
      inputIndex,
      schemas.map((page) => [...page]),
    );
    if (signature(previous) === signature(schemas)) return;
    this.verticalNavigation = undefined;
    this.groupVersions.set(inputIndex, (this.groupVersions.get(inputIndex) ?? 0) + 1);
    this.bindings.forEach((_binding, key) => {
      if ((JSON.parse(key) as [number, number, string])[0] === inputIndex)
        this.bindings.delete(key);
    });
    this.invalidPages.clear();
  }

  private getSchemas(inputIndex: number): Schema[][] {
    return this.displayedSchemas.get(inputIndex) ?? this.getTemplate().schemas;
  }

  private getCurrentFocus(focus?: Focus): Focus | undefined {
    if (!focus) return undefined;
    const pageIndex = this.getSchemas(focus.inputIndex).findIndex((page) =>
      getTextFlowTargets(page).targets.some((target) => target.name === focus.name),
    );
    return pageIndex < 0 ? undefined : { ...focus, pageIndex };
  }

  public getBinding(
    inputIndex: number,
    pageIndex: number,
    schema: Schema,
  ): TextFlowBinding | undefined {
    if (schema.type !== 'text' || schema.readOnly) return undefined;
    const page = this.getSchemas(inputIndex)[pageIndex];
    if (!page) return undefined;
    const { targets, invalidReason } = getTextFlowTargets(page);
    if (invalidReason) {
      if (!this.invalidPages.has(pageIndex)) {
        this.invalidPages.add(pageIndex);
        this.getOptions().onNotice?.({
          type: 'invalid-configuration',
          pageIndex,
          message: invalidReason,
        });
      }
      return undefined;
    }
    if (!targets.some((target) => target.name === schema.name)) return undefined;
    if (!this.legacyNotified && this.state.legacy[inputIndex]?.has(schema.name)) {
      this.legacyNotified = true;
      this.getOptions().onNotice?.({ type: 'legacy', pageIndex, sourceName: schema.name });
    }
    const key = editorKey(inputIndex, pageIndex, schema.name);
    const existing = this.bindings.get(key);
    if (existing) return existing;
    const epoch = this.epoch;
    const groupVersion = this.groupVersions.get(inputIndex) ?? 0;
    const isCurrent = () =>
      epoch === this.epoch && groupVersion === (this.groupVersions.get(inputIndex) ?? 0);
    const isLegacy = () => this.state.legacy[inputIndex]?.has(schema.name) ?? false;
    const binding: TextFlowBinding = {
      get isLegacy() {
        return isLegacy();
      },
      registerEditor: (editor) => {
        if (!isCurrent()) return () => undefined;
        this.editors.set(key, editor);
        const value = this.state.inputs[inputIndex]?.[schema.name] ?? '';
        this.editorValues.set(key, { value, legacy: binding.isLegacy });
        editor.setValue(value, undefined, binding.isLegacy);
        return () => {
          if (this.editors.get(key) === editor) {
            this.editors.delete(key);
            this.editorValues.delete(key);
          }
        };
      },
      commitEdit: (edit) => {
        if (!isCurrent()) return;
        this.edit(inputIndex, pageIndex, schema.name, edit);
      },
      moveCaretVertically: (direction, selection) => {
        if (!isCurrent()) return false;
        const source = this.editors.get(key);
        if (
          !source ||
          (source.element && source.element.ownerDocument.activeElement !== source.element)
        )
          return false;
        const page = this.getSchemas(inputIndex)[pageIndex];
        if (!page) return false;
        const { targets, invalidReason } = getTextFlowTargets(page);
        if (invalidReason) return false;
        const sourceIndex = targets.findIndex(({ name }) => name === schema.name);
        if (sourceIndex < 0) return false;
        const target = targets[sourceIndex + (direction === 'up' ? -1 : 1)];
        if (!target) return false;
        const nextKey = editorKey(inputIndex, pageIndex, target.name);
        const destination = this.editors.get(nextKey);
        if (!destination || destination.isComposing()) return false;
        if (destination.element) {
          if (!destination.element.isConnected) return false;
          if (source.element) {
            const sourceBox = source.element.getBoundingClientRect();
            const destinationBox = destination.element.getBoundingClientRect();
            if (
              (sourceBox.width > 0 || sourceBox.height > 0) &&
              destinationBox.width === 0 &&
              destinationBox.height === 0
            )
              return false;
          }
        }
        const previous = this.verticalNavigation;
        const sourceValue = this.state.inputs[inputIndex]?.[schema.name] ?? '';
        const lineStart = sourceValue.lastIndexOf('\n', selection.focus - 1) + 1;
        const continuing = previous?.key === key && previous.offset === selection.focus;
        const width = continuing
          ? previous.width
          : countTextFlowWidth(sourceValue.slice(lineStart, selection.focus));
        const x = continuing
          ? previous.x
          : (() => {
              const rect = caretRect(source.element, sourceValue, selection.focus);
              return rect && source.element
                ? rect.left - source.element.getBoundingClientRect().left
                : undefined;
            })();
        const targetValue = this.state.inputs[inputIndex]?.[target.name] ?? '';
        const targetStart = direction === 'up' ? targetValue.lastIndexOf('\n') + 1 : 0;
        const targetEnd =
          direction === 'up'
            ? targetValue.length
            : targetValue.indexOf('\n') < 0
              ? targetValue.length
              : targetValue.indexOf('\n');
        const offset =
          visualCaretOffset(destination.element, targetValue, direction, x) ??
          targetStart + getTextFlowOffsetAtWidth(targetValue.slice(targetStart, targetEnd), width);
        destination.focusSelection({ anchor: offset, focus: offset });
        if (
          destination.element &&
          destination.element.ownerDocument.activeElement !== destination.element
        )
          return false;
        destination.element?.scrollIntoView?.({ block: 'nearest' });
        this.verticalNavigation = { key: nextKey, offset, width, x };
        return true;
      },
      clearVerticalNavigation: () => {
        if (isCurrent()) this.verticalNavigation = undefined;
      },
      undo: () => {
        if (!isCurrent()) return;
        this.undo();
      },
      redo: () => {
        if (!isCurrent()) return;
        this.redo();
      },
    };
    this.bindings.set(key, binding);
    return binding;
  }

  private edit(
    inputIndex: number,
    pageIndex: number,
    sourceName: string,
    edit: Parameters<TextFlowBinding['commitEdit']>[0],
  ) {
    this.verticalNavigation = undefined;
    const input = this.state.inputs[inputIndex];
    if (!input) return;
    const before = copySnapshot(this.state);
    const beforeFocus = {
      inputIndex,
      pageIndex,
      name: sourceName,
      selection: edit.beforeSelection ?? edit.selection,
    };
    const result = distributeTextFlow({
      targets: getTextFlowTargets(this.getSchemas(inputIndex)[pageIndex]).targets,
      inputs: input,
      sourceName,
      value: edit.value,
      selection: edit.selection,
      legacyNames: [...this.state.legacy[inputIndex]],
      preferNextRow: edit.preferNextRow,
      deleteBackwardAtStart: edit.deleteBackwardAtStart,
    });
    if (!result.ok) {
      this.restoreFocus(beforeFocus);
      this.getOptions().onNotice?.({
        type: 'overflow',
        pageIndex,
        sourceName,
        message: 'The input does not fit in the available text rows.',
      });
      return;
    }
    // Native input changes the source DOM even when a full row's canonical
    // value stays unchanged after its overflow moves to the next row.
    this.editorValues.delete(editorKey(inputIndex, pageIndex, sourceName));
    const after = copySnapshot(before);
    after.inputs[inputIndex] = { ...result.inputs };
    after.legacy[inputIndex] = new Set(result.legacyNames);
    const afterFocus = {
      inputIndex,
      pageIndex,
      name: result.selection.name,
      selection: { anchor: result.selection.anchor, focus: result.selection.focus },
    };
    if (result.changes.length === 0) {
      this.state = after;
      const source = this.editors.get(editorKey(inputIndex, pageIndex, sourceName));
      // A late final IME input may target the original row after composition
      // already moved the caret. Normalize that row without stealing focus back.
      const sourceActive =
        !source?.element || source.element.ownerDocument.activeElement === source.element;
      this.syncEditors(sourceActive ? afterFocus : undefined, sourceActive);
      return;
    }
    const history: History = { before, after, beforeFocus, afterFocus };
    this.undoHistory.push(history);
    // Bound memory retained for undo, including legacy paragraphs and discarded rows.
    if (this.undoHistory.length > 100) this.undoHistory.shift();
    this.redoHistory = [];
    this.apply({
      ...history,
      id: String(++this.sequence),
      inputIndex,
      pageIndex,
      sourceName,
      discarded: result.discarded,
      undo: [...this.undoHistory],
      redo: [],
    });
  }

  /** Ordinary fields use the same queue so pending flow commits cannot overwrite them. */
  public changeInput(inputIndex: number, name: string, value: string) {
    this.verticalNavigation = undefined;
    if (!this.state.inputs[inputIndex] || this.state.inputs[inputIndex][name] === value) return;
    const before = copySnapshot(this.state);
    const after = copySnapshot(before);
    after.inputs[inputIndex][name] = value;
    this.apply({
      before,
      after,
      id: String(++this.sequence),
      inputIndex,
      pageIndex: -1,
      sourceName: name,
      discarded: [],
      undo: [...this.undoHistory],
      redo: [...this.redoHistory],
    });
  }

  public undo() {
    this.verticalNavigation = undefined;
    const history = this.undoHistory.pop();
    if (!history) return;
    this.redoHistory.push(history);
    const focus = history.beforeFocus;
    this.apply({
      before: copySnapshot(this.state),
      after: this.mergeHistory(history, history.before),
      beforeFocus: history.afterFocus,
      afterFocus: focus,
      id: String(++this.sequence),
      inputIndex: focus?.inputIndex ?? 0,
      pageIndex: focus?.pageIndex ?? 0,
      sourceName: focus?.name ?? '',
      discarded: [],
      undo: [...this.undoHistory],
      redo: [...this.redoHistory],
    });
  }

  public redo() {
    this.verticalNavigation = undefined;
    const history = this.redoHistory.pop();
    if (!history) return;
    this.undoHistory.push(history);
    const focus = history.afterFocus;
    this.apply({
      before: copySnapshot(this.state),
      after: this.mergeHistory(history, history.after),
      beforeFocus: history.beforeFocus,
      afterFocus: focus,
      id: String(++this.sequence),
      inputIndex: focus?.inputIndex ?? 0,
      pageIndex: focus?.pageIndex ?? 0,
      sourceName: focus?.name ?? '',
      discarded: [],
      undo: [...this.undoHistory],
      redo: [...this.redoHistory],
    });
  }

  private apply(transaction: Transaction) {
    this.state = copySnapshot(transaction.after);
    this.syncEditors(transaction.afterFocus);
    if (!this.draining && transaction.discarded.length === 0) {
      this.commitTransaction(transaction);
      return;
    }
    this.queue.push(transaction);
    if (!this.draining) this.startDrain();
  }

  private mergeHistory(history: History, target: Snapshot): Snapshot {
    const result = copySnapshot(this.state);
    history.before.inputs.forEach((before, index) => {
      const after = history.after.inputs[index] ?? {};
      const names = new Set([...Object.keys(before), ...Object.keys(after)]);
      names.forEach((name) => {
        const changed =
          before[name] !== after[name] ||
          history.before.legacy[index]?.has(name) !== history.after.legacy[index]?.has(name);
        if (!changed || !result.inputs[index]) return;
        if (Object.prototype.hasOwnProperty.call(target.inputs[index], name)) {
          result.inputs[index][name] = target.inputs[index][name];
        } else {
          delete result.inputs[index][name];
        }
        if (target.legacy[index]?.has(name)) result.legacy[index].add(name);
        else result.legacy[index].delete(name);
      });
    });
    return result;
  }

  private startDrain() {
    const epoch = this.epoch;
    let resolveDrain!: () => void;
    let rejectDrain!: (reason: unknown) => void;
    const work = new Promise<void>((resolve, reject) => {
      resolveDrain = resolve;
      rejectDrain = reject;
    });
    const pending = work.finally(() => {
      if (this.draining !== pending) return;
      this.draining = undefined;
      if (this.queue.length) this.startDrain();
    });
    this.draining = pending;
    // A save hook may synchronously notify another plugin change. Publish the
    // pending queue first so that change cannot commit provisional body values.
    void this.drain(epoch).then(resolveDrain, rejectDrain);
  }

  private async drain(epoch: number) {
    while (this.queue.length && epoch === this.epoch) {
      const transaction = this.queue[0];
      if (transaction.discarded.length) {
        const save = this.getOptions().onBeforeDiscard;
        try {
          if (!save) throw new Error('A successful pre-discard save is required.');
          const beforeInputs = copyInputs(transaction.before.inputs);
          const proposedInputs = copyInputs(transaction.after.inputs);
          beforeInputs.forEach(Object.freeze);
          proposedInputs.forEach(Object.freeze);
          Object.freeze(beforeInputs);
          Object.freeze(proposedInputs);
          const saved = await save({
            transactionId: transaction.id,
            inputIndex: transaction.inputIndex,
            pageIndex: transaction.pageIndex,
            sourceName: transaction.sourceName,
            beforeInputs,
            proposedInputs,
            discarded: transaction.discarded.map((field) => ({ ...field })),
          });
          if (saved === false) throw new Error('The pre-discard save was declined.');
        } catch (error) {
          if (epoch !== this.epoch) return;
          const restored = copySnapshot(this.committed);
          let hasOrdinaryChanges = false;
          // Cancelling a body overflow must not discard a patient/staff/etc edit
          // made while its durable save was pending. Those fields are independent.
          this.queue.forEach((queued) => {
            if (queued.pageIndex !== -1 || !restored.inputs[queued.inputIndex]) return;
            const name = queued.sourceName;
            const value = queued.after.inputs[queued.inputIndex][name];
            if (restored.inputs[queued.inputIndex][name] !== value) hasOrdinaryChanges = true;
            restored.inputs[queued.inputIndex][name] = value;
          });
          this.queue = [];
          this.state = restored;
          this.verticalNavigation = undefined;
          this.undoHistory = [...this.committedUndo];
          this.redoHistory = [...this.committedRedo];
          // Restore the original caret only if that editor is still active.
          // A user may have moved to another Text row while the save waited.
          const original = transaction.beforeFocus;
          const originalEditor =
            original &&
            this.editors.get(editorKey(original.inputIndex, original.pageIndex, original.name));
          const restoreOriginalFocus = Boolean(
            originalEditor?.element &&
            originalEditor.element.ownerDocument.activeElement === originalEditor.element,
          );
          this.syncEditors(original, restoreOriginalFocus);
          if (hasOrdinaryChanges) {
            this.committed = copySnapshot(restored);
            this.commit(copyInputs(restored.inputs));
          }
          this.getOptions().onNotice?.({
            type: save ? 'save-failed' : 'save-required',
            pageIndex: transaction.pageIndex,
            sourceName: transaction.sourceName,
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
      if (epoch !== this.epoch) return;
      this.queue.shift();
      this.commitTransaction(transaction);
      if (transaction.discarded.length)
        this.getOptions().onNotice?.({
          type: 'discarded',
          pageIndex: transaction.pageIndex,
          sourceName: transaction.sourceName,
          discarded: transaction.discarded.map((field) => ({ ...field })),
        });
    }
  }

  private commitTransaction(transaction: Transaction) {
    this.committed = copySnapshot(transaction.after);
    this.committedUndo = [...transaction.undo];
    this.committedRedo = [...transaction.redo];
    this.commit(copyInputs(this.committed.inputs));
  }

  private restoreFocus(focus: Focus) {
    const current = this.getCurrentFocus(focus);
    if (!current) return;
    focus = current;
    const editor = this.editors.get(editorKey(focus.inputIndex, focus.pageIndex, focus.name));
    editor?.setValue(
      this.state.inputs[focus.inputIndex]?.[focus.name] ?? '',
      focus.selection,
      this.state.legacy[focus.inputIndex]?.has(focus.name),
    );
    if (!this.hasComposition()) editor?.focusSelection(focus.selection);
  }

  private syncEditors(focus?: Focus, moveFocus = true) {
    const currentFocus = this.getCurrentFocus(focus);
    this.editors.forEach((editor, key) => {
      const [inputIndex, pageIndex, name] = JSON.parse(key) as [number, number, string];
      const isFocus =
        currentFocus?.inputIndex === inputIndex &&
        currentFocus.pageIndex === pageIndex &&
        currentFocus.name === name;
      const value = this.state.inputs[inputIndex]?.[name] ?? '';
      const legacy = this.state.legacy[inputIndex]?.has(name) ?? false;
      const previous = this.editorValues.get(key);
      if (isFocus || !previous || previous.value !== value || previous.legacy !== legacy) {
        this.editorValues.set(key, { value, legacy });
        editor.setValue(value, isFocus ? currentFocus.selection : undefined, legacy);
      }
    });
    if (currentFocus && moveFocus) {
      const editor = this.editors.get(
        editorKey(currentFocus.inputIndex, currentFocus.pageIndex, currentFocus.name),
      );
      if (!this.hasComposition()) editor?.focusSelection(currentFocus.selection);
    }
  }

  private hasComposition() {
    return [...this.editors.values()].some((editor) => editor.isComposing());
  }
}

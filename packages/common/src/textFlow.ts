import type { Schema, Template } from './types.js';

export type TextFlowSelection = { anchor: number; focus: number };
export type TextFlowTarget = {
  name: string;
  legacyName: string;
  row: number;
  maxLength: number;
};
export type TextFlowChangedValue = { name: string; value: string };
export type TextFlowDiscardEvent = {
  transactionId: string;
  inputIndex: number;
  pageIndex: number;
  sourceName: string;
  beforeInputs: ReadonlyArray<Readonly<Record<string, string>>>;
  proposedInputs: ReadonlyArray<Readonly<Record<string, string>>>;
  discarded: ReadonlyArray<TextFlowChangedValue>;
};
export type TextFlowNotice = {
  type:
    | 'overflow'
    | 'discarded'
    | 'save-failed'
    | 'save-required'
    | 'invalid-configuration'
    | 'legacy';
  message?: string;
  sourceName?: string;
  pageIndex?: number;
  discarded?: ReadonlyArray<TextFlowChangedValue>;
};
export type TextFlowOptions = {
  enabled: boolean;
  onBeforeDiscard?: (event: TextFlowDiscardEvent) => void | boolean | Promise<void | boolean>;
  onNotice?: (notice: TextFlowNotice) => void;
};
/** Offsets use UTF-16, matching DOM Range offsets. */
export type TextFlowEdit = {
  value: string;
  selection: TextFlowSelection;
  beforeSelection?: TextFlowSelection;
  inputType?: string;
  preferNextRow?: boolean;
  /** Backspace at a row start joins rows; short hard boundaries retain text, while soft wraps and empty rows delete the previous grapheme. */
  deleteBackwardAtStart?: boolean;
};
export type TextFlowEditor = {
  element?: HTMLElement;
  setValue(value: string, selection?: TextFlowSelection, legacy?: boolean): void;
  readSelection(): TextFlowSelection;
  focusSelection(selection: TextFlowSelection): void;
  isComposing(): boolean;
};
/** A binding belongs to one field; updates never require rebuilding its editor DOM. */
export type TextFlowBinding = {
  isLegacy: boolean;
  registerEditor(editor: TextFlowEditor): () => void;
  commitEdit(edit: TextFlowEdit): void | Promise<void>;
  /** Move between text rows on the same displayed page without editing their values. */
  moveCaretVertically?: (direction: 'up' | 'down', selection: TextFlowSelection) => boolean;
  clearVerticalNavigation?: () => void;
  undo?(): void;
  redo?(): void;
};

export const parseTextFlowName = (name: string): TextFlowTarget | undefined => {
  const match = /^text(\d+)(?:-(\d+))?$/.exec(name);
  if (!match) return undefined;
  const row = Number(match[1]);
  const maxLength = match[2] ? Number(match[2]) : 20;
  if (
    !Number.isSafeInteger(row) ||
    row <= 0 ||
    !Number.isSafeInteger(maxLength) ||
    maxLength <= 0
  ) {
    return undefined;
  }
  return { name, legacyName: `text${match[1]}`, row, maxLength };
};

export const getTextFlowTargets = (
  schemas: ReadonlyArray<Pick<Schema, 'name' | 'type' | 'readOnly'>>,
): { targets: TextFlowTarget[]; invalidReason?: string } => {
  const targets: TextFlowTarget[] = [];
  const rows = new Set<number>();
  for (const schema of schemas) {
    if (schema.type !== 'text' || schema.readOnly) continue;
    const target = parseTextFlowName(schema.name);
    if (!target) continue;
    if (rows.has(target.row)) {
      return { targets: [], invalidReason: `Duplicate text row number: ${target.row}` };
    }
    rows.add(target.row);
    targets.push(target);
  }
  targets.sort((a, b) => a.row - b.row);
  return { targets };
};

/** Materialize aliases once, before rendering, saving, or PDF generation. */
export const hydrateTextFlowInputs = <T extends Record<string, unknown>>(
  template: Pick<Template, 'schemas'>,
  inputs: ReadonlyArray<T>,
): T[] => {
  const aliases = template.schemas.flatMap((page) =>
    page.flatMap((schema) => {
      if (schema.type !== 'text' || schema.readOnly) return [];
      const target = parseTextFlowName(schema.name);
      return target && target.name !== target.legacyName ? [target] : [];
    }),
  );
  return inputs.map((input) => {
    const hydrated = { ...input };
    for (const { name, legacyName } of aliases) {
      if (
        !Object.prototype.hasOwnProperty.call(hydrated, name) &&
        Object.prototype.hasOwnProperty.call(input, legacyName)
      ) {
        Object.defineProperty(hydrated, name, {
          value: input[legacyName],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return hydrated;
  });
};

type Grapheme = { value: string; start: number; end: number; width: number };
type SegmenterConstructor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => { segment(value: string): Iterable<{ segment: string; index: number }> };
const combiningMark = /\p{Mark}/u;
const emoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const isVariationSelector = (code: number) =>
  (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef);
const isRegionalIndicator = (code: number) => code >= 0x1f1e6 && code <= 0x1f1ff;

const graphemeWidth = (value: string) => {
  if (emoji.test(value)) return 1;
  let width = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (combiningMark.test(character) || isVariationSelector(code) || code === 0x200d) continue;
    if (code === 10 || code === 13) continue;
    if (code > 0x7f && (code < 0xff61 || code > 0xff9f)) return 1;
    width += 0.5;
  }
  return width;
};

const fallbackSegments = (value: string): Array<{ segment: string; index: number }> => {
  const segments: Array<{ segment: string; index: number }> = [];
  let offset = 0;
  let regionalCount = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const previous = segments[segments.length - 1];
    const joinsPrevious =
      previous &&
      (combiningMark.test(character) ||
        isVariationSelector(code) ||
        code === 0x200d ||
        previous.segment.endsWith('\u200d') ||
        (code >= 0x1f3fb && code <= 0x1f3ff) ||
        code === 0xff9e ||
        code === 0xff9f ||
        (isRegionalIndicator(code) && regionalCount % 2 === 1));
    if (joinsPrevious) previous.segment += character;
    else segments.push({ segment: character, index: offset });
    regionalCount = isRegionalIndicator(code) ? regionalCount + 1 : 0;
    offset += character.length;
  }
  return segments;
};

const getGraphemes = (value: string, start = 0): Grapheme[] => {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  const segments = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value))
    : fallbackSegments(value);
  return segments.map(({ segment, index }) => ({
    value: segment,
    start: start + index,
    end: start + index + segment.length,
    width: graphemeWidth(segment),
  }));
};

/** Fullwidth equivalents: ASCII/halfwidth kana are 0.5, CJK/emoji are 1. */
export const countTextFlowWidth = (value: string): number =>
  getGraphemes(value).reduce((width, grapheme) => width + grapheme.width, 0);

export const getTextFlowCaretOffsets = (value: string): number[] => [
  0,
  ...getGraphemes(value).map(({ end }) => end),
];

/** Return a safe caret boundary nearest to a fullwidth-equivalent column. */
export const getTextFlowOffsetAtWidth = (value: string, wantedWidth: number): number => {
  let width = 0;
  for (const grapheme of getGraphemes(value)) {
    const nextWidth = width + grapheme.width;
    if (wantedWidth < nextWidth) {
      return wantedWidth - width < nextWidth - wantedWidth ? grapheme.start : grapheme.end;
    }
    width = nextWidth;
  }
  return value.length;
};

export const getTextFlowLegacyNames = (
  targets: ReadonlyArray<TextFlowTarget>,
  inputs: Readonly<Record<string, string>>,
): string[] =>
  targets
    .filter(({ name, maxLength }) => {
      const value = inputs[name] || '';
      return /[\r\n]/.test(value) || countTextFlowWidth(value) > maxLength;
    })
    .map(({ name }) => name);

type Chunk = { value: string; start: number; end: number; targetIndex: number; legacy: boolean };

/** Saved with the input values so an automatic wrap stays distinguishable from an explicit row break. */
const softBreaksKey = '__pdfme_text_flow_soft_after';

type SavedSoftBreaks = Record<string, number[]>;

const readSoftBreaks = (inputs: Readonly<Record<string, string>>): SavedSoftBreaks => {
  try {
    const parsed: unknown = JSON.parse(inputs[softBreaksKey] || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number[]] =>
          Array.isArray(entry[1]) && entry[1].every(Number.isSafeInteger),
      ),
    );
  } catch {
    return {};
  }
};

const softBreakPageKey = (targets: ReadonlyArray<TextFlowTarget>) =>
  JSON.stringify(targets.map(({ name, maxLength }) => [name, maxLength]));

/** Newline offsets are retained for caret mapping, including explicit empty lines. */
const layoutValue = (
  value: string,
  targets: ReadonlyArray<TextFlowTarget>,
  startIndex: number,
): { chunks: Chunk[]; overflowStart?: number } => {
  const chunks: Chunk[] = [];
  const lines = value.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g);
  for (const line of lines) {
    if (!line[1]) {
      // The last zero-length match only terminates the regexp. Every empty
      // line followed by a newline is a real paragraph and occupies a row.
      if (!/[\r\n]$/.test(line[0])) continue;
      const targetIndex = startIndex + chunks.length;
      if (!targets[targetIndex]) return { chunks, overflowStart: line.index };
      chunks.push({ value: '', start: line.index, end: line.index, targetIndex, legacy: false });
      continue;
    }
    const graphemes = getGraphemes(line[1], line.index);
    let text = '';
    let width = 0;
    let chunkStart = graphemes[0].start;
    let chunkEnd = chunkStart;
    for (const grapheme of graphemes) {
      const targetIndex = startIndex + chunks.length;
      const target = targets[targetIndex];
      if (!target) return { chunks, overflowStart: grapheme.start };
      if (text && width + grapheme.width > target.maxLength) {
        chunks.push({ value: text, start: chunkStart, end: chunkEnd, targetIndex, legacy: false });
        text = '';
        width = 0;
        chunkStart = grapheme.start;
        if (!targets[startIndex + chunks.length]) {
          return { chunks, overflowStart: grapheme.start };
        }
      }
      if (grapheme.width > targets[startIndex + chunks.length].maxLength) {
        return { chunks, overflowStart: grapheme.start };
      }
      text += grapheme.value;
      width += grapheme.width;
      chunkEnd = grapheme.end;
    }
    if (text) {
      chunks.push({
        value: text,
        start: chunkStart,
        end: chunkEnd,
        targetIndex: startIndex + chunks.length,
        legacy: false,
      });
    }
  }
  return { chunks };
};

export type DistributeTextFlowArgs = {
  targets: ReadonlyArray<TextFlowTarget>;
  inputs: Readonly<Record<string, string>>;
  sourceName: string;
  value: string;
  selection?: TextFlowSelection;
  legacyNames?: ReadonlyArray<string>;
  preferNextRow?: boolean;
  deleteBackwardAtStart?: boolean;
};
export type TextFlowDistribution =
  | { ok: false; reason: 'source-overflow' | 'invalid-source' | 'invalid-configuration' }
  | {
      ok: true;
      inputs: Record<string, string>;
      changes: TextFlowChangedValue[];
      discarded: TextFlowChangedValue[];
      selection: TextFlowSelection & { name: string };
      legacyNames: string[];
    };

const mapSelection = (
  chunks: Chunk[],
  targets: ReadonlyArray<TextFlowTarget>,
  selection: TextFlowSelection,
  sourceIndex: number,
): TextFlowSelection & { name: string } => {
  const mapOffset = (offset: number) => {
    if (!chunks.length) return { name: targets[sourceIndex].name, offset: 0 };
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const next = chunks[i + 1];
      if (offset < chunk.end || (offset === chunk.end && next?.start !== offset)) {
        return {
          name: targets[chunk.targetIndex].name,
          offset: Math.max(0, Math.min(offset - chunk.start, chunk.value.length)),
        };
      }
    }
    const last = chunks[chunks.length - 1];
    return { name: targets[last.targetIndex].name, offset: last.value.length };
  };
  const anchor = mapOffset(selection.anchor);
  const focus = mapOffset(selection.focus);
  // A native editor selection belongs to one field. An edit spanning fields collapses at focus.
  return {
    name: focus.name,
    anchor: anchor.name === focus.name ? anchor.offset : focus.offset,
    focus: focus.offset,
  };
};

/** Compute the whole transaction without mutating inputs; the caller must authorize discarded tails. */
export const distributeTextFlow = (args: DistributeTextFlowArgs): TextFlowDistribution => {
  const { inputs } = args;
  let { sourceName, value } = args;
  const targets = [...args.targets].sort((a, b) => a.row - b.row);
  if (
    new Set(targets.map(({ row }) => row)).size !== targets.length ||
    targets.some(
      ({ row, maxLength }) =>
        !Number.isSafeInteger(row) ||
        row <= 0 ||
        !Number.isSafeInteger(maxLength) ||
        maxLength <= 0,
    )
  ) {
    return { ok: false, reason: 'invalid-configuration' };
  }
  let sourceIndex = targets.findIndex(({ name }) => name === sourceName);
  if (sourceIndex < 0) return { ok: false, reason: 'invalid-source' };
  const legacy = new Set(args.legacyNames ?? getTextFlowLegacyNames(targets, inputs));
  const savedSoftBreaks = readSoftBreaks(inputs);
  const pageKey = softBreakPageKey(targets);
  const softBreaks = new Set(
    (savedSoftBreaks[pageKey] ?? []).filter((index) => index >= 0 && index < targets.length - 1),
  );
  let selection = args.selection ?? { anchor: value.length, focus: value.length };
  let joinedEndIndex: number | undefined;
  const deletingFromEmptyRow = args.deleteBackwardAtStart && sourceIndex > 0 && value === '';
  if (args.deleteBackwardAtStart && sourceIndex > 0) {
    // Backspace explicitly removes a row boundary, even for saved rows without
    // soft-break metadata. A full previous row also loses its final grapheme.
    const currentIndex = sourceIndex;
    const currentIsLegacy = legacy.has(sourceName);
    let previousStartIndex = currentIndex - 1;
    while (
      previousStartIndex > 0 &&
      softBreaks.has(previousStartIndex - 1) &&
      inputs[targets[previousStartIndex - 1].name] &&
      !legacy.has(targets[previousStartIndex - 1].name)
    )
      previousStartIndex--;
    // A nonempty current row joins the preceding paragraph. An empty row is
    // an explicit blank paragraph: delete the preceding grapheme, but leave
    // that row and everything below it in place.
    joinedEndIndex = deletingFromEmptyRow ? currentIndex - 1 : currentIndex;
    while (
      softBreaks.has(joinedEndIndex) &&
      joinedEndIndex + 1 < targets.length &&
      inputs[targets[joinedEndIndex + 1].name] &&
      !legacy.has(targets[joinedEndIndex + 1].name)
    )
      joinedEndIndex++;
    const prefix = targets
      .slice(previousStartIndex, currentIndex)
      .map(({ name }) => inputs[name] || '')
      .join('');
    const previousRow = targets[currentIndex - 1];
    const previousRowIsFull =
      countTextFlowWidth(inputs[previousRow.name] || '') >= previousRow.maxLength;
    // An empty current row still deletes the previous character but remains in
    // place. A soft wrap has no hard boundary to remove, even when its unused
    // half-width slot cannot fit the next full-width grapheme.
    const deletePreviousGrapheme =
      deletingFromEmptyRow || previousRowIsFull || softBreaks.has(currentIndex - 1);
    const joinedPrefix = deletePreviousGrapheme
      ? prefix.slice(0, getGraphemes(prefix).at(-1)?.start ?? prefix.length)
      : prefix;
    const suffix = targets
      .slice(currentIndex + 1, joinedEndIndex + 1)
      .map(({ name }) => inputs[name] || '')
      .join('');
    sourceIndex = previousStartIndex;
    sourceName = targets[sourceIndex].name;
    if (currentIsLegacy) legacy.add(sourceName);
    value = joinedPrefix + value + suffix;
    selection = { anchor: joinedPrefix.length, focus: joinedPrefix.length };
  }
  const sourceIsLegacy = legacy.has(sourceName) && value !== '';
  // A live newline at the end inserts an empty row before existing text below.
  // In particular, a saved automatic continuation must become a displaced
  // paragraph rather than being appended after the newline and filling that row.
  const insertBlankAfterSource = !sourceIsLegacy && args.preferNextRow && /[\r\n]$/.test(value);
  let sourceEndIndex = sourceIndex;
  if (joinedEndIndex !== undefined) {
    sourceEndIndex = joinedEndIndex;
  } else if (!sourceIsLegacy && !insertBlankAfterSource) {
    while (
      softBreaks.has(sourceEndIndex) &&
      sourceEndIndex + 1 < targets.length &&
      inputs[targets[sourceEndIndex + 1].name] &&
      !legacy.has(targets[sourceEndIndex + 1].name)
    )
      sourceEndIndex++;
  }
  const continuationValue =
    joinedEndIndex === undefined
      ? targets
          .slice(sourceIndex + 1, sourceEndIndex + 1)
          .map(({ name }) => inputs[name] || '')
          .join('')
      : '';
  const sourceValue = value + continuationValue;
  const sourceLayout = sourceIsLegacy
    ? {
        chunks: [{ value, start: 0, end: value.length, targetIndex: sourceIndex, legacy: true }],
        overflowStart: undefined,
      }
    : layoutValue(sourceValue, targets, sourceIndex);
  if (sourceLayout.overflowStart !== undefined && sourceLayout.overflowStart < value.length)
    return { ok: false, reason: 'source-overflow' };
  const sourceChunks = sourceLayout.chunks;
  // Emptying a paragraph keeps its row. This also covers deleting the sole
  // grapheme before an empty row and pressing Enter in an empty row.
  if (sourceChunks.length === 0) {
    sourceChunks.push({ value: '', start: 0, end: 0, targetIndex: sourceIndex, legacy: false });
  }
  if (insertBlankAfterSource) {
    const targetIndex = sourceIndex + sourceChunks.length;
    if (!targets[targetIndex]) return { ok: false, reason: 'source-overflow' };
    sourceChunks.push({
      value: '',
      start: value.length,
      end: value.length,
      targetIndex,
      legacy: false,
    });
  }
  // Keep a preceding automatic wrap when text from the next soft row fills
  // this row. A new empty or explicitly separated row ends that wrap.
  const breaksPreviousSoftRow =
    softBreaks.has(sourceIndex - 1) && (/^[\r\n]/.test(value) || sourceChunks[0].value === '');
  const result = { ...inputs };
  const discarded: TextFlowChangedValue[] = [];

  if (
    sourceEndIndex === sourceIndex &&
    sourceChunks.length === 1 &&
    !insertBlankAfterSource &&
    !breaksPreviousSoftRow
  ) {
    result[sourceName] = sourceChunks[0].value;
    if (!sourceIsLegacy) legacy.delete(sourceName);
  } else {
    const paragraphs: { name: string; value: string; legacy: boolean }[] = [];
    for (let index = sourceEndIndex + 1; index < targets.length; index++) {
      const name = targets[index].name;
      let paragraph = inputs[name] || '';
      const isLegacy = legacy.has(name);
      if (!isLegacy) {
        while (
          softBreaks.has(index) &&
          index + 1 < targets.length &&
          inputs[targets[index + 1].name] &&
          !legacy.has(targets[index + 1].name)
        )
          paragraph += inputs[targets[++index].name];
      }
      paragraphs.push({ name, value: paragraph, legacy: isLegacy });
    }
    for (const { name } of targets.slice(sourceIndex)) {
      result[name] = '';
      legacy.delete(name);
    }
    const nextSoftBreaks = new Set([...softBreaks].filter((index) => index < sourceIndex));
    if (breaksPreviousSoftRow) nextSoftBreaks.delete(sourceIndex - 1);
    const place = (chunks: Chunk[]) => {
      chunks.forEach((chunk, index) => {
        const name = targets[chunk.targetIndex].name;
        result[name] = chunk.value;
        if (chunk.legacy) legacy.add(name);
        const next = chunks[index + 1];
        if (next?.value && next.start === chunk.end) nextSoftBreaks.add(chunk.targetIndex);
      });
    };
    place(sourceChunks);
    let nextIndex = sourceIndex + sourceChunks.length;
    if (sourceLayout.overflowStart !== undefined) {
      discarded.push({
        name: targets[sourceIndex + 1]?.name ?? sourceName,
        value: sourceValue.slice(sourceLayout.overflowStart),
      });
      nextIndex = targets.length;
    }
    for (const paragraph of paragraphs) {
      if (!targets[nextIndex]) {
        if (paragraph.value) discarded.push({ name: paragraph.name, value: paragraph.value });
        continue;
      }
      if (!paragraph.value) {
        nextIndex++;
        continue;
      }
      const layout = paragraph.legacy
        ? {
            chunks: [
              {
                value: paragraph.value,
                start: 0,
                end: paragraph.value.length,
                targetIndex: nextIndex,
                legacy: true,
              },
            ],
            overflowStart: undefined,
          }
        : layoutValue(paragraph.value, targets, nextIndex);
      place(layout.chunks);
      nextIndex += layout.chunks.length;
      if (layout.overflowStart !== undefined) {
        discarded.push({
          name: paragraph.name,
          value: paragraph.value.slice(layout.overflowStart),
        });
        nextIndex = targets.length;
      }
    }
    if (nextSoftBreaks.size) savedSoftBreaks[pageKey] = [...nextSoftBreaks].sort((a, b) => a - b);
    else delete savedSoftBreaks[pageKey];
    if (Object.keys(savedSoftBreaks).length)
      result[softBreaksKey] = JSON.stringify(savedSoftBreaks);
    else delete result[softBreaksKey];
  }
  return {
    ok: true,
    inputs: result,
    changes: [...targets.map(({ name }) => name), softBreaksKey].flatMap((name) =>
      result[name] !== inputs[name] ? [{ name, value: result[name] ?? '' }] : [],
    ),
    discarded,
    selection: mapSelection(sourceChunks, targets, selection, sourceIndex),
    legacyNames: [...legacy],
  };
};

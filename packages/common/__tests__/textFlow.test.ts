import {
  countTextFlowWidth,
  distributeTextFlow,
  getTextFlowLegacyNames,
  getTextFlowTargets,
  hydrateTextFlowInputs,
  parseTextFlowName,
  type TextFlowDistribution,
  type TextFlowTarget,
} from '../src/textFlow';
import { CommonOptions } from '../src/schema';
import type { Schema } from '../src/types';

const targets = (...caps: number[]): TextFlowTarget[] =>
  caps.map((cap, index) => parseTextFlowName(`text${index + 1}-${cap}`)!);
const successful = (result: TextFlowDistribution) => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.reason);
  return result;
};
const softBreaksKey = '__pdfme_text_flow_soft_after';
const bodyInputs = (inputs: Record<string, string>) => {
  const { [softBreaksKey]: _softBreaks, ...body } = inputs;
  return body;
};
const softAfter = (inputs: Record<string, string>): number[] =>
  Object.values(JSON.parse(inputs[softBreaksKey] || '{}') as Record<string, number[]>).flat();
const page = (names: string[]): Schema[] =>
  names.map((name) => ({
    name,
    type: 'text',
    position: { x: 0, y: 0 },
    width: 10,
    height: 5,
  }));

describe('text flow configuration and legacy aliases', () => {
  test.each([
    ['text1', 1, 20, 'text1'],
    ['text01', 1, 20, 'text01'],
    ['text001', 1, 20, 'text001'],
    ['text1-20', 1, 20, 'text1'],
    ['text02-8', 2, 8, 'text02'],
    ['text003-15', 3, 15, 'text003'],
    ['text1-020', 1, 20, 'text1'],
  ])('parses %s without changing zero padding', (name, row, maxLength, legacyName) => {
    expect(parseTextFlowName(String(name))).toEqual({ name, row, maxLength, legacyName });
  });

  test.each([
    'text0',
    'text000',
    'Text1',
    'text1-0',
    'text1-00',
    'text1--1',
    'text1-8a',
    'text9007199254740992',
    'text1-9007199254740992',
    'patientName',
  ])('ignores %s', (name) => {
    expect(parseTextFlowName(name)).toBeUndefined();
  });

  test('uses numeric ordering, existing targets, type, and editability', () => {
    const schemas = page(['text010', 'text002-8', 'text1', 'patientName', 'text3', 'text4']);
    schemas[4].readOnly = true;
    schemas[5].type = 'image';
    expect(getTextFlowTargets(schemas).targets.map(({ name }) => name)).toEqual([
      'text1',
      'text002-8',
      'text010',
    ]);
  });

  test('duplicate numeric rows fail closed on that page', () => {
    const result = getTextFlowTargets(page(['text1', 'text001-8', 'text2']));
    expect(result.targets).toEqual([]);
    expect(result.invalidReason).toContain('1');
  });

  test('hydrates missing current keys while preserving empty current keys and unrelated data', () => {
    const input = Object.freeze({
      text1: 'old 1',
      'text1-20': '',
      text02: 'old 2',
      text001: 'old 001',
      patientName: 'kept',
      unrelated: ['kept array'],
    });
    const template = { schemas: [page(['text1-20', 'text02-8', 'text001-20', 'patientName'])] };
    const [hydrated] = hydrateTextFlowInputs(template, [input]);
    expect(hydrated).toEqual({
      ...input,
      'text02-8': 'old 2',
      'text001-20': 'old 001',
    });
    expect(hydrated['text1-20']).toBe('');
    expect(input).not.toHaveProperty('text02-8');
    expect(hydrated).not.toBe(input);
  });

  test('current key presence wins even when undefined; inherited old keys never hydrate', () => {
    const input = Object.assign(Object.create({ text02: 'inherited' }), {
      text1: 'old',
      'text1-20': undefined,
    }) as Record<string, unknown>;
    const [hydrated] = hydrateTextFlowInputs({ schemas: [page(['text1-20', 'text02-8'])] }, [
      input,
    ]);
    expect(hydrated).toHaveProperty('text1-20', undefined);
    expect(hydrated).not.toHaveProperty('text02-8');
  });

  test('callbacks are validated but neither invoked nor required on disabled options', () => {
    const hook = jest.fn();
    expect(
      CommonOptions.safeParse({ textFlow: { enabled: true, onBeforeDiscard: hook } }).success,
    ).toBe(true);
    expect(CommonOptions.safeParse({ textFlow: { enabled: false } }).success).toBe(true);
    expect(
      CommonOptions.safeParse({ textFlow: { enabled: true, onNotice: 'wrong' } }).success,
    ).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('fullwidth equivalents and grapheme safety', () => {
  test.each([
    ['abc 123', 3.5],
    ['ｶﾀｶﾅ', 2],
    ['ｶﾞ', 1],
    ['漢字　', 3],
    ['e\u0301', 0.5],
    ['か\u3099', 1],
    ['👨‍👩‍👧‍👦', 1],
    ['🇯🇵', 1],
    ['1️⃣', 1],
    ['A\r\nB', 1],
  ])('counts %s as %s', (value, width) => {
    expect(countTextFlowWidth(String(value))).toBe(width);
  });

  test('fallback joins marks, emoji joins, and flags without breaking clusters', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true });
    try {
      expect(countTextFlowWidth('e\u0301か\u3099👨‍👩‍👧‍👦🇯🇵ｶﾞ')).toBe(4.5);
      const result = successful(
        distributeTextFlow({
          targets: targets(1, 1, 1),
          inputs: {},
          sourceName: 'text1-1',
          value: '👨‍👩‍👧‍👦🇯🇵か\u3099',
        }),
      );
      expect(Object.values(bodyInputs(result.inputs))).toEqual(['👨‍👩‍👧‍👦', '🇯🇵', 'か\u3099']);
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
      else Reflect.deleteProperty(Intl, 'Segmenter');
    }
  });
});

describe('transactional row distribution', () => {
  test('100 fullwidth characters fill five default rows; ASCII uses halfwidth equivalents', () => {
    const rows = getTextFlowTargets(
      page(Array.from({ length: 16 }, (_, i) => `text${i + 1}`)),
    ).targets;
    const result = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1',
        value: 'あ'.repeat(100),
      }),
    );
    expect(rows.slice(0, 5).map(({ name }) => result.inputs[name])).toEqual(
      Array(5).fill('あ'.repeat(20)),
    );
    const ascii = successful(
      distributeTextFlow({ targets: rows, inputs: {}, sourceName: 'text1', value: 'a'.repeat(40) }),
    );
    expect(ascii.inputs.text1).toHaveLength(40);
    expect(ascii.changes).toHaveLength(1);
    const longAscii = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1',
        value: 'a'.repeat(100),
      }),
    );
    expect(rows.slice(0, 3).map(({ name }) => longAscii.inputs[name].length)).toEqual([40, 40, 20]);
  });

  test('mixed newline styles and empty lines split by each destination limit without trimming spaces', () => {
    const result = successful(
      distributeTextFlow({
        targets: targets(2, 1, 3, 2, 2),
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえお\r\n\r\n  \rか\n',
      }),
    );
    expect(Object.values(bodyInputs(result.inputs))).toEqual(['あい', 'う', 'えお', '  ', 'か']);
  });

  test('starts at clicked row and keeps later paragraphs separate while pushing them', () => {
    const before = Object.freeze({
      'text1-2': '先',
      'text2-2': '',
      'text3-2': '次',
      'text4-2': '後',
      other: 'kept',
    });
    const result = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2, 2, 2),
        inputs: before,
        sourceName: 'text2-2',
        value: 'あいう',
      }),
    );
    expect(bodyInputs(result.inputs)).toEqual({
      ...before,
      'text2-2': 'あい',
      'text3-2': 'う',
      'text4-2': '次',
      'text5-2': '後',
    });
    expect(before['text3-2']).toBe('次');
  });

  test('saved rows without wrap metadata remain separate paragraphs', () => {
    const edited = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2),
        inputs: { 'text1-2': 'あい', 'text2-2': 'うえ' },
        sourceName: 'text1-2',
        value: 'かあい',
      }),
    );
    expect(bodyInputs(edited.inputs)).toEqual({
      'text1-2': 'かあ',
      'text2-2': 'い',
      'text3-2': 'うえ',
    });
    expect(softAfter(edited.inputs)).toEqual([0]);
  });

  test('Backspace at the start of a saved second row deletes the previous grapheme and joins it', () => {
    const before = { 'text1-4': '甲乙丙欄', 'text2-4': 'だけです', 'text3-4': '' };
    const joined = successful(
      distributeTextFlow({
        targets: targets(4, 4, 4),
        inputs: before,
        sourceName: 'text2-4',
        value: 'だけです',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );
    expect(bodyInputs(joined.inputs)).toEqual({
      'text1-4': '甲乙丙だ',
      'text2-4': 'けです',
      'text3-4': '',
    });
    expect(softAfter(joined.inputs)).toEqual([0]);
    expect(joined.selection).toEqual({ name: 'text1-4', anchor: 3, focus: 3 });
    expect(before).toEqual({ 'text1-4': '甲乙丙欄', 'text2-4': 'だけです', 'text3-4': '' });
  });

  test('Backspace on a blank row deletes the preceding final grapheme and closes the blank row', () => {
    const before = {
      'text1-4': '甲乙丙欄',
      'text2-4': '',
      'text3-4': 'だけです',
      'text4-4': '後',
    };
    const edited = successful(
      distributeTextFlow({
        targets: targets(4, 4, 4, 4),
        inputs: before,
        sourceName: 'text2-4',
        value: '',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );
    expect(bodyInputs(edited.inputs)).toEqual({
      'text1-4': '甲乙丙',
      'text2-4': 'だけです',
      'text3-4': '後',
      'text4-4': '',
    });
    expect(softAfter(edited.inputs)).toEqual([]);
    expect(edited.selection).toEqual({ name: 'text1-4', anchor: 3, focus: 3 });
    expect(before['text1-4']).toBe('甲乙丙欄');
  });

  test.each(['欄', '👨‍👩‍👧‍👦'])(
    'Backspace after the sole preceding grapheme %s keeps that row empty',
    (previous) => {
      const edited = successful(
        distributeTextFlow({
          targets: targets(4, 4, 4, 4),
          inputs: { 'text1-4': previous, 'text2-4': '', 'text3-4': '次', 'text4-4': '後' },
          sourceName: 'text2-4',
          value: '',
          selection: { anchor: 0, focus: 0 },
          deleteBackwardAtStart: true,
        }),
      );
      expect(bodyInputs(edited.inputs)).toEqual({
        'text1-4': '',
        'text2-4': '次',
        'text3-4': '後',
        'text4-4': '',
      });
      expect(edited.selection).toEqual({ name: 'text1-4', anchor: 0, focus: 0 });
    },
  );

  test('Backspace on a blank row shortens a preceding soft paragraph', () => {
    const rows = targets(2, 2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    const edited = successful(
      distributeTextFlow({
        targets: rows,
        inputs: { ...created.inputs, 'text3-2': '', 'text4-2': '後' },
        sourceName: 'text3-2',
        value: '',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );
    expect(bodyInputs(edited.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': 'う',
      'text3-2': '後',
      'text4-2': '',
    });
    expect(softAfter(edited.inputs)).toEqual([0]);
    expect(edited.selection).toEqual({ name: 'text2-2', anchor: 1, focus: 1 });
  });

  test('Backspace joins an automatic continuation and deletes one whole emoji grapheme', () => {
    const rows = targets(2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あ👨‍👩‍👧‍👦だけ',
      }),
    );
    expect(bodyInputs(created.inputs)).toEqual({
      'text1-2': 'あ👨‍👩‍👧‍👦',
      'text2-2': 'だけ',
      'text3-2': '',
    });
    const joined = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text2-2',
        value: 'だけ',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );
    expect(bodyInputs(joined.inputs)).toEqual({
      'text1-2': 'あだ',
      'text2-2': 'け',
      'text3-2': '',
    });
    expect(softAfter(joined.inputs)).toEqual([0]);
    expect(joined.selection).toEqual({ name: 'text1-2', anchor: 1, focus: 1 });
  });

  test('Backspace joins the preceding soft paragraph and the current soft continuation', () => {
    const rows = targets(2, 2, 2, 2);
    const first = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    const second = successful(
      distributeTextFlow({
        targets: rows,
        inputs: first.inputs,
        sourceName: 'text3-2',
        value: 'だけです',
      }),
    );
    expect(bodyInputs(second.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': 'うえ',
      'text3-2': 'だけ',
      'text4-2': 'です',
    });
    expect(softAfter(second.inputs)).toEqual([0, 2]);
    const joined = successful(
      distributeTextFlow({
        targets: rows,
        inputs: second.inputs,
        sourceName: 'text3-2',
        value: 'だけ',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );
    expect(bodyInputs(joined.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': 'うだ',
      'text3-2': 'けで',
      'text4-2': 'す',
    });
    expect(softAfter(joined.inputs)).toEqual([0, 1, 2]);
    expect(joined.selection).toEqual({ name: 'text2-2', anchor: 1, focus: 1 });
  });

  test('Backspace keeps a joined legacy value whole, including its newline', () => {
    const joined = successful(
      distributeTextFlow({
        targets: targets(2, 2),
        inputs: { 'text1-2': '旧\n欄', 'text2-2': 'だけ' },
        sourceName: 'text2-2',
        value: 'だけ',
        selection: { anchor: 0, focus: 0 },
        deleteBackwardAtStart: true,
      }),
    );
    expect(joined.inputs).toEqual({ 'text1-2': '旧\nだけ', 'text2-2': '' });
    expect(joined.legacyNames).toContain('text1-2');
    expect(joined.selection).toEqual({ name: 'text1-2', anchor: 2, focus: 2 });
  });

  test('insertion and deletion reflow only automatic continuation rows after reload', () => {
    const rows = targets(2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    expect(softAfter(created.inputs)).toEqual([0]);
    const inserted = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text1-2',
        value: 'かあい',
      }),
    );
    expect(bodyInputs(inserted.inputs)).toEqual({
      'text1-2': 'かあ',
      'text2-2': 'いう',
      'text3-2': 'え',
    });
    expect(softAfter(inserted.inputs)).toEqual([0, 1]);
    const deleted = successful(
      distributeTextFlow({
        targets: rows,
        inputs: inserted.inputs,
        sourceName: 'text1-2',
        value: 'あ',
      }),
    );
    expect(bodyInputs(deleted.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': 'うえ',
      'text3-2': '',
    });
    expect(softAfter(deleted.inputs)).toEqual([0]);
  });

  test('explicit newline remains a hard boundary even when the preceding row is full', () => {
    const rows = targets(2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あい\nうえ',
      }),
    );
    expect(softAfter(created.inputs)).toEqual([]);
    const inserted = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text1-2',
        value: 'かあい',
      }),
    );
    expect(bodyInputs(inserted.inputs)).toEqual({
      'text1-2': 'かあ',
      'text2-2': 'い',
      'text3-2': 'うえ',
    });
    expect(softAfter(inserted.inputs)).toEqual([0]);
  });

  test('Enter after a soft-wrapped row inserts a blank before its saved continuation', () => {
    const rows = targets(2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    const split = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text1-2',
        value: 'あい\n',
        selection: { anchor: 3, focus: 3 },
        preferNextRow: true,
      }),
    );
    expect(bodyInputs(split.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': '',
      'text3-2': 'うえ',
    });
    expect(softAfter(split.inputs)).toEqual([]);
    expect(split.selection).toEqual({ name: 'text2-2', anchor: 0, focus: 0 });
  });

  test('Enter in the middle of a soft-wrapped paragraph preserves the earlier soft break', () => {
    const rows = targets(2, 2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえおか',
      }),
    );
    expect(softAfter(created.inputs)).toEqual([0, 1]);
    const split = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text2-2',
        value: 'うえ\n',
        selection: { anchor: 3, focus: 3 },
        preferNextRow: true,
      }),
    );
    expect(bodyInputs(split.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': 'うえ',
      'text3-2': '',
      'text4-2': 'おか',
    });
    expect(softAfter(split.inputs)).toEqual([0]);
    expect(split.selection).toEqual({ name: 'text3-2', anchor: 0, focus: 0 });
  });

  test('Enter shifts a saved soft continuation and later rows, discarding only the final tail', () => {
    const rows = targets(2, 2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    const split = successful(
      distributeTextFlow({
        targets: rows,
        inputs: { ...created.inputs, 'text3-2': '甲', 'text4-2': '乙' },
        sourceName: 'text1-2',
        value: 'あい\n',
        selection: { anchor: 3, focus: 3 },
        preferNextRow: true,
      }),
    );
    expect(bodyInputs(split.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': '',
      'text3-2': 'うえ',
      'text4-2': '甲',
    });
    expect(split.discarded).toEqual([{ name: 'text4-2', value: '乙' }]);
    expect(softAfter(split.inputs)).toEqual([]);
    expect(split.selection).toEqual({ name: 'text2-2', anchor: 0, focus: 0 });
  });

  test('a newline at the start of an automatic continuation makes that boundary hard', () => {
    const rows = targets(2, 2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    const split = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text2-2',
        value: '\nうえ',
      }),
    );
    expect(bodyInputs(split.inputs)).toEqual({
      'text1-2': 'あい',
      'text2-2': 'うえ',
      'text3-2': '',
    });
    expect(softAfter(split.inputs)).toEqual([]);
  });

  test('presave is required before an edit discards an automatic continuation tail', () => {
    const rows = targets(2, 2);
    const created = successful(
      distributeTextFlow({
        targets: rows,
        inputs: {},
        sourceName: 'text1-2',
        value: 'あいうえ',
      }),
    );
    const inserted = successful(
      distributeTextFlow({
        targets: rows,
        inputs: created.inputs,
        sourceName: 'text1-2',
        value: 'かあい',
      }),
    );
    expect(bodyInputs(inserted.inputs)).toEqual({ 'text1-2': 'かあ', 'text2-2': 'いう' });
    expect(inserted.discarded).toEqual([{ name: 'text2-2', value: 'え' }]);
    expect(softAfter(inserted.inputs)).toEqual([0]);
  });

  test('single-row edit preserves later positions, including gaps', () => {
    const input = { 'text1-2': 'あ', 'text2-2': '', 'text3-2': '後', extra: 'kept' };
    const result = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: 'いう',
      }),
    );
    expect(result.inputs).toEqual({ ...input, 'text1-2': 'いう' });
    expect(result.changes).toEqual([{ name: 'text1-2', value: 'いう' }]);
  });

  test('existing normal paragraph re-splits using destination cap, returning only displaced tail', () => {
    const result = successful(
      distributeTextFlow({
        targets: targets(2, 3, 1),
        inputs: { 'text1-2': '', 'text2-3': 'えおか', other: 'kept' },
        sourceName: 'text1-2',
        value: 'あいう',
        legacyNames: [],
      }),
    );
    expect(result.inputs['text3-1']).toBe('え');
    expect(result.discarded).toEqual([{ name: 'text2-3', value: 'おか' }]);
    expect(result.inputs.other).toBe('kept');
  });

  test('new source overflow rejects the entire proposal without mutation', () => {
    const input = Object.freeze({ 'text1-1': '旧', 'text2-1': '次' });
    expect(
      distributeTextFlow({
        targets: targets(1, 1),
        inputs: input,
        sourceName: 'text1-1',
        value: 'あいう',
      }),
    ).toEqual({ ok: false, reason: 'source-overflow' });
    expect(input).toEqual({ 'text1-1': '旧', 'text2-1': '次' });
  });

  test('shortening does not pull rows up, but emptying source pulls whole following rows', () => {
    const input = { 'text1-2': 'あい', 'text2-2': 'う', 'text3-2': '', 'text4-2': 'え' };
    const short = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: 'あ',
      }),
    );
    expect(short.inputs['text2-2']).toBe('う');
    const deleted = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: '',
      }),
    );
    expect(deleted.inputs).toEqual({
      'text1-2': 'う',
      'text2-2': 'え',
      'text3-2': '',
      'text4-2': '',
    });
    expect(deleted.selection).toEqual({ name: 'text1-2', anchor: 0, focus: 0 });
  });

  test('explicit deletion compacts an already blank continuation while empty edit does not', () => {
    const input = { 'text1-2': '', 'text2-2': '次' };
    const idle = successful(
      distributeTextFlow({
        targets: targets(2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: '',
      }),
    );
    expect(idle.inputs).toEqual(input);
    const deleted = successful(
      distributeTextFlow({
        targets: targets(2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: '',
        allowDeletionPullUp: true,
      }),
    );
    expect(deleted.inputs).toEqual({ 'text1-2': '次', 'text2-2': '' });
  });

  test('live trailing newline reserves one continuation and moves existing row; paste does not', () => {
    const input = { 'text1-2': 'あ', 'text2-2': '次', 'text3-2': '' };
    const live = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: 'あ\n\n',
        preferNextRow: true,
      }),
    );
    expect(live.inputs).toEqual({ 'text1-2': 'あ', 'text2-2': '', 'text3-2': '次' });
    expect(live.selection).toEqual({ name: 'text2-2', anchor: 0, focus: 0 });
    const paste = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2),
        inputs: input,
        sourceName: 'text1-2',
        value: 'あ\n',
      }),
    );
    expect(paste.inputs).toEqual(input);
    const empty = successful(
      distributeTextFlow({
        targets: targets(2, 2, 2),
        inputs: { ...input, 'text1-2': '' },
        sourceName: 'text1-2',
        value: '\n\n',
        preferNextRow: true,
      }),
    );
    expect(empty.inputs['text2-2']).toBe('次');
    expect(empty.selection.name).toBe('text1-2');
    expect(
      distributeTextFlow({
        targets: targets(2),
        inputs: { 'text1-2': 'あ' },
        sourceName: 'text1-2',
        value: 'あ\n',
        preferNextRow: true,
      }),
    ).toEqual({ ok: false, reason: 'source-overflow' });
  });

  test('maps UTF-16 caret position without splitting emoji and retains backward selection', () => {
    const moved = successful(
      distributeTextFlow({
        targets: targets(1, 1),
        inputs: {},
        sourceName: 'text1-1',
        value: 'あ😀',
        selection: { anchor: 3, focus: 3 },
      }),
    );
    expect(moved.selection).toEqual({ name: 'text2-1', anchor: 2, focus: 2 });
    const selected = successful(
      distributeTextFlow({
        targets: targets(2, 2),
        inputs: {},
        sourceName: 'text1-2',
        value: 'AB',
        selection: { anchor: 2, focus: 0 },
      }),
    );
    expect(selected.selection).toEqual({ name: 'text1-2', anchor: 2, focus: 0 });
  });

  test('legacy source remains whole while edited; shifted legacy keeps flag and original text', () => {
    const rows = targets(1, 2, 1, 2);
    const input = { 'text1-1': '', 'text2-2': '古い\n長文', 'text3-1': '後' };
    expect(getTextFlowLegacyNames(rows, input)).toEqual(['text2-2']);
    const edited = successful(
      distributeTextFlow({
        targets: rows,
        inputs: input,
        sourceName: 'text2-2',
        value: 'さらに古い\n長文',
      }),
    );
    expect(edited.inputs['text2-2']).toBe('さらに古い\n長文');
    expect(edited.inputs['text3-1']).toBe('後');
    const shifted = successful(
      distributeTextFlow({ targets: rows, inputs: input, sourceName: 'text1-1', value: 'あいう' }),
    );
    expect(shifted.inputs['text3-1']).toBe('古い\n長文');
    expect(shifted.legacyNames).toEqual(['text3-1']);
    expect(shifted.inputs['text4-2']).toBe('後');
    const shortened = successful(
      distributeTextFlow({
        targets: rows,
        inputs: shifted.inputs,
        sourceName: 'text3-1',
        value: '短',
        legacyNames: shifted.legacyNames,
      }),
    );
    expect(shortened.legacyNames).toContain('text3-1');
  });
});

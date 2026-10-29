import { distributeTextFlow, getTextFlowTargets } from '../src/textFlow';

const targets = (names: string[]) =>
  getTextFlowTargets(names.map((name) => ({ name, type: 'text' }))).targets;
test('document truncation retains whole graphemes and the destination-specific limits', () => {
  const result = distributeTextFlow({
    targets: targets(['text1-1', 'text2-2', 'text3-1']),
    inputs: {},
    sourceName: 'text1-1',
    value: '👨‍👩‍👧‍👦あいうえ',
    overflow: 'truncate',
  });
  expect(result).toMatchObject({
    ok: true,
    inputs: { 'text1-1': '👨‍👩‍👧‍👦', 'text2-2': 'あい', 'text3-1': 'う' },
    truncated: 'え',
    discarded: [],
  });
});
test('the default continues to reject whole over-capacity edits', () => {
  expect(
    distributeTextFlow({
      targets: targets(['text1-2']),
      inputs: { 'text1-2': 'あ' },
      sourceName: 'text1-2',
      value: 'あいう',
    }),
  ).toEqual({ ok: false, reason: 'source-overflow' });
});
test('a full final row truncates another newline without reverting existing speech', () => {
  expect(
    distributeTextFlow({
      targets: targets(['text1-2']),
      inputs: { 'text1-2': 'あい' },
      sourceName: 'text1-2',
      value: 'あい\n',
      preferNextRow: true,
      overflow: 'truncate',
    }),
  ).toMatchObject({ ok: true, inputs: { 'text1-2': 'あい' }, truncated: '\n' });
});
test('new text and displaced old soft continuation are kept separate for backup', () => {
  const key = JSON.stringify([
    ['text1-2', 2],
    ['text2-2', 2],
  ]);
  expect(
    distributeTextFlow({
      targets: targets(['text1-2', 'text2-2']),
      inputs: {
        'text1-2': 'あい',
        'text2-2': '既存',
        __pdfme_text_flow_soft_after: JSON.stringify({ [key]: [0] }),
      },
      sourceName: 'text1-2',
      value: 'あいうえお',
      overflow: 'truncate',
    }),
  ).toMatchObject({
    ok: true,
    inputs: { 'text1-2': 'あい', 'text2-2': 'うえ' },
    truncated: 'お',
    discarded: [{ name: 'text2-2', value: '既存' }],
  });
});

test('migrated page metadata is removed so a later explicit break cannot revive it', () => {
  const key = JSON.stringify([
    ['text1-2', 2],
    ['text2-2', 2],
  ]);
  const result = distributeTextFlow({
    targets: targets(['text1-2', 'text2-2', 'text3-2']),
    crossPage: true,
    inputs: {
      'text1-2': 'あい',
      'text2-2': 'うえ',
      __pdfme_text_flow_soft_after: JSON.stringify({ [key]: [0] }),
    },
    sourceName: 'text1-2',
    value: 'あ',
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(JSON.parse(result.inputs.__pdfme_text_flow_soft_after)[key]).toBeUndefined();
  const second = distributeTextFlow({
    targets: targets(['text1-2', 'text2-2', 'text3-2']),
    crossPage: true,
    inputs: result.inputs,
    sourceName: 'text1-2',
    value: '新\n段',
  });
  expect(second.ok).toBe(true);
  if (second.ok) expect(second.inputs.__pdfme_text_flow_soft_after).toBeUndefined();
});

test('an existing emoji suffix displaced by another emoji is backed up as a whole grapheme', () => {
  expect(
    distributeTextFlow({
      targets: targets(['text1-1']),
      inputs: { 'text1-1': '😀' },
      sourceName: 'text1-1',
      value: '😁😀',
      overflow: 'truncate',
    }),
  ).toMatchObject({ ok: true, truncated: '😀', discarded: [{ name: 'text1-1', value: '😀' }] });
});

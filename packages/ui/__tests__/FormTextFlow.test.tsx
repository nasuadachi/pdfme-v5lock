import React from 'react';
import { act } from '@testing-library/react';
import { BLANK_A4_PDF, type Schema, type Template, type TextFlowDiscardEvent } from '@pdfme/common';
import Form from '../src/Form';
import type { TextFlowController } from '../src/textFlow';

type CapturedPreview = {
  textFlowController?: TextFlowController;
  inputs: Record<string, string>[];
  onChangeInput: (change: { index: number; name: string; value: string }) => void;
};
let mockPreviewProps: CapturedPreview;
jest.mock('../src/components/Preview', () => ({
  __esModule: true,
  default: (props: CapturedPreview) => {
    mockPreviewProps = props;
    return React.createElement('div');
  },
}));
jest.mock('@pdfme/schemas', () => ({ builtInPlugins: {} }));

class TestForm extends Form {
  public renderForTest() {
    this.render();
  }
}
const row = (name: string): Schema => ({
  name,
  type: 'text',
  position: { x: 0, y: 0 },
  width: 100,
  height: 10,
});
const names = ['text01-2', 'text002-2', 'text3-2'];
const template: Template = { basePdf: BLANK_A4_PDF, schemas: [names.map(row)] };
const bodyInputs = (input: Record<string, string>) => {
  const { __pdfme_text_flow_soft_after: _softAfter, ...body } = input;
  return body;
};

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

test('Form hydrates old keys for getInputs, preserves explicit current blanks and unrelated values', () => {
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [{ text01: '旧', text002: '戻さない', [names[1]]: '', patientName: '患者' }],
    options: { textFlow: { enabled: true } },
  });
  expect(form.getInputs()[0]).toEqual({
    text01: '旧',
    [names[0]]: '旧',
    text002: '戻さない',
    [names[1]]: '',
    patientName: '患者',
  });
  form.destroy();
});

test('all Form change callbacks observe the completed multi-row transaction', () => {
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [{ [names[0]]: '', [names[1]]: '甲', [names[2]]: '' }],
    options: { textFlow: { enabled: true } },
  });
  const observed: Record<string, string>[][] = [];
  form.onChangeInput(() => {
    observed.push(form.getInputs().map((input) => ({ ...input })));
  });
  act(() => {
    form.renderForTest();
  });
  act(() => {
    mockPreviewProps
      .textFlowController!.getBinding(0, 0, row(names[0]))!
      .commitEdit({ value: 'あいう', selection: { anchor: 3, focus: 3 } });
  });
  expect(observed).toHaveLength(4);
  observed.forEach((inputs) =>
    expect(bodyInputs(inputs[0])).toEqual({
      [names[0]]: 'あい',
      [names[1]]: 'う',
      [names[2]]: '甲',
    }),
  );
  form.destroy();
});

test('Form getInputs stays old until pre-discard persistence succeeds and settlement waits', async () => {
  let resolve!: (saved: boolean) => void;
  let snapshot!: TextFlowDiscardEvent;
  const before = { [names[0]]: 'あ', [names[1]]: '甲', [names[2]]: '乙' };
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [before],
    options: {
      textFlow: {
        enabled: true,
        onBeforeDiscard: (event) => {
          snapshot = event;
          return new Promise<boolean>((done) => {
            resolve = done;
          });
        },
      },
    },
  });
  act(() => {
    form.renderForTest();
  });
  act(() => {
    mockPreviewProps
      .textFlowController!.getBinding(0, 0, row(names[0]))!
      .commitEdit({ value: 'あいう', selection: { anchor: 3, focus: 3 } });
  });
  expect(form.getInputs()).toEqual([before]);
  expect(snapshot.beforeInputs).toEqual([before]);
  let settled = false;
  const pending = form.whenInputsSettled().then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  await act(async () => {
    resolve(true);
    await pending;
  });
  expect(bodyInputs(form.getInputs()[0])).toEqual({
    [names[0]]: 'あい',
    [names[1]]: 'う',
    [names[2]]: '甲',
  });
  form.destroy();
});

test('invalid setInputs leaves the existing controller and canonical state usable', () => {
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [{ [names[0]]: '', [names[1]]: '', [names[2]]: '' }],
    options: { textFlow: { enabled: true } },
  });
  act(() => {
    form.renderForTest();
  });
  expect(() => form.setInputs([])).toThrow();
  act(() => {
    mockPreviewProps
      .textFlowController!.getBinding(0, 0, row(names[0]))!
      .commitEdit({ value: 'あいう', selection: { anchor: 3, focus: 3 } });
  });
  expect(form.getInputs()[0][names[1]]).toBe('う');
  form.destroy();
});

test.each([true, false])(
  'table arrays stay normalized after setInputs and editing when text flow is %s',
  (enabled) => {
    const form = new TestForm({
      domContainer: document.createElement('div'),
      template,
      inputs: [{ [names[0]]: '', [names[1]]: '', [names[2]]: '', table: [['old']] }],
      options: { textFlow: { enabled } },
    });
    const loaded = {
      [names[0]]: '',
      [names[1]]: '',
      [names[2]]: '',
      table: [['new']],
      patientName: 'patient',
    };
    const observed: Record<string, string>[][] = [];
    form.onChangeInput(() => observed.push(form.getInputs().map((input) => ({ ...input }))));
    act(() => form.renderForTest());
    expect(form.getInputs()[0].table).toBe('[["old"]]');
    act(() => form.setInputs([loaded] as unknown as Record<string, string>[]));
    expect(loaded.table).toEqual([['new']]);
    expect(form.getInputs()[0].table).toBe('[["new"]]');
    expect(observed).toHaveLength(2);
    observed.forEach((inputs) => expect(inputs[0]).toEqual({ ...loaded, table: '[["new"]]' }));
    act(() => {
      if (enabled) {
        mockPreviewProps.textFlowController!.getBinding(0, 0, row(names[0]))!.commitEdit({
          value: '本文',
          selection: { anchor: 2, focus: 2 },
        });
      } else {
        mockPreviewProps.onChangeInput({ index: 0, name: names[0], value: '本文' });
      }
    });
    expect(form.getInputs()[0].table).toBe('[["new"]]');
    expect(form.getInputs()[0].patientName).toBe('patient');
    expect(form.getInputs()[0][names[0]]).toBe('本文');
    form.destroy();
  },
);

test('setInputs cancels an old pending transaction before rendering normalized replacement inputs', async () => {
  let resolve!: (saved: boolean) => void;
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [{ [names[0]]: 'あ', [names[1]]: '甲', [names[2]]: '乙' }],
    options: {
      textFlow: {
        enabled: true,
        onBeforeDiscard: () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      },
    },
  });
  act(() => form.renderForTest());
  act(() => {
    mockPreviewProps.textFlowController!.getBinding(0, 0, row(names[0]))!.commitEdit({
      value: 'あいう',
      selection: { anchor: 3, focus: 3 },
    });
  });
  act(() =>
    form.setInputs([
      {
        [names[0]]: '',
        [names[1]]: '',
        [names[2]]: '',
        table: [['replacement']],
      },
    ] as unknown as Record<string, string>[]),
  );
  await act(async () => {
    resolve(true);
    await Promise.resolve();
    await form.whenInputsSettled();
  });
  expect(form.getInputs()[0]).toEqual({
    [names[0]]: '',
    [names[1]]: '',
    [names[2]]: '',
    table: '[["replacement"]]',
  });
  act(() => {
    mockPreviewProps.textFlowController!.getBinding(0, 0, row(names[0]))!.commitEdit({
      value: '新本文',
      selection: { anchor: 3, focus: 3 },
    });
  });
  expect(bodyInputs(form.getInputs()[0])).toEqual({
    [names[0]]: '新本',
    [names[1]]: '文',
    [names[2]]: '',
    table: '[["replacement"]]',
  });
  form.destroy();
});

test('a disabled Form retains the original input keys and ordinary change callback ordering', () => {
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [{ text01: '旧' }],
    options: { textFlow: { enabled: false } },
  });
  act(() => {
    form.renderForTest();
  });
  expect(mockPreviewProps.textFlowController).toBeUndefined();
  expect(form.getInputs()[0][names[0]]).toBeUndefined();
  const oldValues: string[] = [];
  form.onChangeInput(() => oldValues.push(form.getInputs()[0].text01));
  act(() => {
    mockPreviewProps.onChangeInput({ index: 0, name: 'text01', value: '更新' });
  });
  expect(oldValues).toEqual(['旧']);
  expect(form.getInputs()[0].text01).toBe('更新');
  form.destroy();
});

test('a synchronous plugin notification during presave cannot commit provisional body values', async () => {
  let reject!: (error: Error) => void;
  const before = { [names[0]]: 'あ', [names[1]]: '甲', [names[2]]: '乙', patientName: '患者' };
  const form = new TestForm({
    domContainer: document.createElement('div'),
    template,
    inputs: [before],
    options: {
      textFlow: {
        enabled: true,
        onBeforeDiscard: () => {
          mockPreviewProps.onChangeInput({ index: 0, name: 'patientName', value: '更新患者' });
          return new Promise<void>((_resolve, fail) => {
            reject = fail;
          });
        },
      },
    },
  });
  act(() => {
    form.renderForTest();
  });
  const changes = jest.fn();
  form.onChangeInput(changes);
  act(() => {
    mockPreviewProps
      .textFlowController!.getBinding(0, 0, row(names[0]))!
      .commitEdit({ value: 'あいう', selection: { anchor: 3, focus: 3 } });
  });
  expect(form.getInputs()).toEqual([before]);
  expect(changes).not.toHaveBeenCalled();
  await act(async () => {
    reject(new Error('save-failed'));
    await form.whenInputsSettled();
  });
  expect(form.getInputs()).toEqual([{ ...before, patientName: '更新患者' }]);
  expect(changes).toHaveBeenCalledTimes(1);
  form.destroy();
});

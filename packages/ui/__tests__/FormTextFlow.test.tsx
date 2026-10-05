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
  expect(observed).toHaveLength(3);
  observed.forEach((inputs) =>
    expect(inputs[0]).toEqual({
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
  expect(form.getInputs()[0]).toEqual({ [names[0]]: 'あい', [names[1]]: 'う', [names[2]]: '甲' });
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

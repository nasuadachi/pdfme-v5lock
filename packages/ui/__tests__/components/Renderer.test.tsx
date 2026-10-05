import React from 'react';
import { render, waitFor } from '@testing-library/react';
import {
  BLANK_A4_PDF,
  type Plugin,
  type SchemaForUI,
  type TextFlowBinding,
  pluginRegistry,
} from '@pdfme/common';
import Renderer from '../../src/components/Renderer';
import { PluginsRegistry, OptionsContext } from '../../src/contexts';

test('Renderer keeps uninterrupted plugin DOM on scale-only changes', async () => {
  const ui = jest.fn();
  const schema = {
    id: 'stable-plugin-field',
    name: 'stablePluginField',
    type: 'stablePlugin',
    content: '',
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
  } as SchemaForUI;
  const plugin: Plugin = {
    pdf: jest.fn(),
    ui,
    propPanel: { schema: {}, defaultSchema: schema },
    uninterruptedEditMode: true,
  };
  const registry = pluginRegistry({ stablePlugin: plugin });

  const renderRenderer = (scale: number, value = 'value') => (
    <PluginsRegistry.Provider value={registry}>
      <Renderer
        schema={schema}
        basePdf={BLANK_A4_PDF}
        value={value}
        mode="form"
        outline="transparent"
        scale={scale}
      />
    </PluginsRegistry.Provider>
  );

  const view = render(renderRenderer(1));
  await waitFor(() => expect(ui).toHaveBeenCalledTimes(1));

  view.rerender(renderRenderer(0.5));
  await Promise.resolve();
  expect(ui).toHaveBeenCalledTimes(1);

  view.rerender(renderRenderer(0.5, 'changed'));
  await waitFor(() => expect(ui).toHaveBeenCalledTimes(2));
});

test('Renderer preserves a bound text editor on input and scale changes and unregisters on replacement', async () => {
  const unregister = jest.fn();
  const binding: TextFlowBinding = {
    isLegacy: false,
    registerEditor: jest.fn(() => unregister),
    commitEdit: jest.fn(),
  };
  const ui: Plugin['ui'] = jest.fn((props) => {
    const element = document.createElement('div');
    element.contentEditable = 'true';
    element.textContent = props.value;
    props.rootElement.appendChild(element);
    props.textFlow?.registerEditor({
      element,
      setValue: jest.fn(),
      readSelection: () => ({ anchor: 0, focus: 0 }),
      focusSelection: jest.fn(),
      isComposing: () => false,
    });
  });
  const schema = {
    id: 'bound-text',
    name: 'text01',
    type: 'text',
    content: '',
    position: { x: 0, y: 0 },
    width: 100,
    height: 10,
  } as SchemaForUI;
  const registry = pluginRegistry({
    text: { ui, pdf: jest.fn(), propPanel: { schema: {}, defaultSchema: schema } },
  });
  const field = (value: string, scale: number, textFlow?: TextFlowBinding) => (
    <PluginsRegistry.Provider value={registry}>
      <Renderer
        schema={schema}
        basePdf={BLANK_A4_PDF}
        value={value}
        mode="form"
        outline="transparent"
        scale={scale}
        textFlow={textFlow}
      />
    </PluginsRegistry.Provider>
  );
  const view = render(field('あ', 1, binding));
  await waitFor(() => expect(ui).toHaveBeenCalledTimes(1));
  const original = view.container.querySelector('[contenteditable]');
  view.rerender(field('あいう', 0.5, binding));
  expect(view.container.querySelector('[contenteditable]')).toBe(original);
  expect(ui).toHaveBeenCalledTimes(1);
  view.rerender(field('あいう', 0.5));
  await waitFor(() => expect(ui).toHaveBeenCalledTimes(2));
  expect(unregister).toHaveBeenCalledTimes(1);
});

test('native structuredClone never receives text-flow callbacks and replacing handlers keeps the editor alive', async () => {
  const originalClone = globalThis.structuredClone;
  // jsdom's existing JSON clone fallback silently drops functions. Reproduce the
  // browser's rejection so this catches the actual Chrome DataCloneError.
  globalThis.structuredClone = <T,>(value: T): T => {
    const assertCloneable = (entry: unknown) => {
      if (typeof entry === 'function')
        throw new DOMException('Cannot clone a function', 'DataCloneError');
      if (entry && typeof entry === 'object') Object.values(entry).forEach(assertCloneable);
    };
    assertCloneable(value);
    return originalClone(value);
  };
  try {
    const ui = jest.fn();
    const schema = {
      id: 'callback-text',
      name: 'text01',
      type: 'text',
      position: { x: 0, y: 0 },
      width: 100,
      height: 10,
    } as SchemaForUI;
    const binding: TextFlowBinding = {
      isLegacy: false,
      registerEditor: () => () => undefined,
      commitEdit: jest.fn(),
    };
    const registry = pluginRegistry({
      text: { ui, pdf: jest.fn(), propPanel: { schema: {}, defaultSchema: schema } },
    });
    const field = (onBeforeDiscard: () => Promise<boolean>, onNotice: () => void) => (
      <OptionsContext.Provider value={{ textFlow: { enabled: true, onBeforeDiscard, onNotice } }}>
        <PluginsRegistry.Provider value={registry}>
          <Renderer
            schema={schema}
            basePdf={BLANK_A4_PDF}
            value="あ"
            mode="form"
            outline="transparent"
            scale={1}
            textFlow={binding}
          />
        </PluginsRegistry.Provider>
      </OptionsContext.Provider>
    );
    const save = jest.fn(async () => true);
    const notice = jest.fn();
    const view = render(field(save, notice));
    await waitFor(() => expect(ui).toHaveBeenCalledTimes(1));
    expect(ui.mock.calls[0][0].options.textFlow.onBeforeDiscard).toBe(save);
    expect(ui.mock.calls[0][0].options.textFlow.onNotice).toBe(notice);
    view.rerender(
      field(
        jest.fn(async () => true),
        jest.fn(),
      ),
    );
    expect(ui).toHaveBeenCalledTimes(1);
  } finally {
    globalThis.structuredClone = originalClone;
  }
});

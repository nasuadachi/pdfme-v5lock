import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { BLANK_A4_PDF, type Plugin, type SchemaForUI, pluginRegistry } from '@pdfme/common';
import Renderer from '../../src/components/Renderer';
import { PluginsRegistry } from '../../src/contexts';

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

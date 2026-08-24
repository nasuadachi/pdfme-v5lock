/** @jest-environment jsdom */

import { TextDecoder, TextEncoder } from 'util';

Object.assign(globalThis, { TextDecoder, TextEncoder });

let propPanel: typeof import('../src/multiVariableText/propPanel.js').propPanel;

describe('multiVariableText property panel', () => {
  beforeAll(async () => {
    ({ propPanel } = await import('../src/multiVariableText/propPanel.js'));
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('recovers when the placeholder field is committed after its widget', async () => {
    const widget = propPanel.widgets?.mapDynamicVariables;
    const formElement = document.createElement('form');
    const parentElement = document.createElement('div');
    const rootElement = document.createElement('div');
    parentElement.appendChild(rootElement);
    formElement.appendChild(parentElement);
    document.body.appendChild(formElement);

    expect(widget).toBeDefined();
    expect(() =>
      widget!({
        rootElement,
        activeSchema: {
          ...propPanel.defaultSchema,
          id: 'multi-variable-text-test',
        },
        changeSchemas: () => undefined,
        i18n: (key: string) => key,
        options: {},
      } as never),
    ).not.toThrow();

    const placeholderRow = document.createElement('div');
    placeholderRow.className = 'ant-form-item';
    const placeholder = document.createElement('textarea');
    placeholder.id = 'placeholder-dynamic-var';
    placeholderRow.appendChild(placeholder);
    formElement.appendChild(placeholderRow);

    await Promise.resolve();

    expect(placeholderRow.style.display).toBe('none');
    expect(rootElement.querySelector('p')).not.toBeNull();
  });
});

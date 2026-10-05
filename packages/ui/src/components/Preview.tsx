import React, { useRef, useState, useEffect, useContext } from 'react';
import {
  Template,
  SchemaForUI,
  PreviewProps,
  Size,
  getDynamicTemplate,
  replacePlaceholders,
} from '@pdfme/common';
import { getDynamicHeightsForTable } from '@pdfme/schemas/utils';
import UnitPager from './UnitPager.js';
import Root from './Root.js';
import StaticSchema from './StaticSchema.js';
import ErrorScreen from './ErrorScreen.js';
import CtlBar from './CtlBar.js';
import Paper from './Paper.js';
import Renderer from './Renderer.js';
import { useUIPreProcessor, useScrollPageCursor } from '../hooks.js';
import { FontContext, OptionsContext } from '../contexts.js';
import { template2SchemasList, getPagesScrollTopByIndex, useMaxZoom } from '../helper.js';
import { theme } from 'antd';
import type { TextFlowController } from '../textFlow.js';

const _cache = new Map<string | number, unknown>();

const Preview = ({
  template,
  inputs,
  size,
  onChangeInput,
  onPageChange,
  textFlowController,
}: Omit<PreviewProps, 'domContainer'> & {
  onChangeInput?: (args: { index: number; value: string; name: string }) => void;
  onPageChange?: (pageInfo: { currentPage: number; totalPages: number }) => void;
  size: Size;
  textFlowController?: TextFlowController;
}) => {
  const { token } = theme.useToken();

  const font = useContext(FontContext);
  const options = useContext(OptionsContext);
  const maxZoom = useMaxZoom();

  const containerRef = useRef<HTMLDivElement>(null);
  const paperRefs = useRef<HTMLDivElement[]>([]);

  const [unitCursor, setUnitCursor] = useState(0);
  const [pageCursor, setPageCursor] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(options.zoomLevel ?? 1);
  const [schemasList, setSchemasList] = useState<SchemaForUI[][]>([[]] as SchemaForUI[][]);
  const initSequence = useRef(0);
  const currentPreview = useRef({ template, inputs, unitCursor, textFlowController });
  currentPreview.current = { template, inputs, unitCursor, textFlowController };

  const { backgrounds, pageSizes, scale, error, refresh } = useUIPreProcessor({
    template,
    size,
    zoomLevel,
    maxZoom,
  });

  const isForm = Boolean(onChangeInput);

  const input = inputs[unitCursor];
  // Bind against the pages currently on screen, including expanded table pages.
  // Supplying a group does not modify inputs or React state.
  textFlowController?.setDisplayedSchemas(unitCursor, schemasList);

  const init = (template: Template, inputOverride?: Record<string, string>) => {
    const sequence = ++initSequence.current;
    const inputIndex = unitCursor;
    const controller = textFlowController;
    const isCurrent = () =>
      sequence === initSequence.current &&
      currentPreview.current.unitCursor === inputIndex &&
      currentPreview.current.template === template &&
      currentPreview.current.textFlowController === controller;
    const update = async () => {
      while (isCurrent()) {
        // A queued table edit must use the final canonical inputs, rather than
        // reflowing provisional text while its pre-discard save is unresolved.
        await controller?.whenInputsSettled();
        if (!isCurrent()) return;
        const currentInput = controller
          ? currentPreview.current.inputs[inputIndex]
          : (inputOverride ?? currentPreview.current.inputs[inputIndex]);
        const inputSignature = JSON.stringify(currentInput);
        const dynamicTemplate = await getDynamicTemplate({
          template,
          input: currentInput,
          options: { font },
          _cache,
          getDynamicHeights: (value, args) => {
            switch (args.schema.type) {
              case 'table':
                return getDynamicHeightsForTable(value, args);
              default:
                return Promise.resolve([args.schema.height]);
            }
          },
        });
        const sl = await template2SchemasList(dynamicTemplate);
        await controller?.whenInputsSettled();
        if (!isCurrent()) return;
        if (
          controller &&
          inputSignature !== JSON.stringify(currentPreview.current.inputs[inputIndex])
        )
          continue;
        setSchemasList(sl);
        if (dynamicTemplate !== template) {
          await refresh(dynamicTemplate);
        }
        return;
      }
    };
    void update().catch((err) => console.error(`[@pdfme/ui] `, err));
  };

  useEffect(
    () => () => {
      initSequence.current += 1;
    },
    [],
  );

  // Update component state only when _options_ changes
  // Ignore exhaustive useEffect dependency warnings here
  useEffect(() => {
    if (typeof options.zoomLevel === 'number' && options.zoomLevel !== zoomLevel) {
      setZoomLevel(options.zoomLevel);
    }
    // eslint-disable-next-line
  }, [options]);

  useEffect(() => {
    if (unitCursor > inputs.length - 1) {
      setUnitCursor(inputs.length - 1);
    }

    init(template);
    // V5LOCK-BACKPORT-20260823-SAFARI-PINCH-STABILITY
    // Size-only changes must not parse the PDF and recreate the schema list.
  }, [template, inputs, unitCursor, textFlowController]);

  useScrollPageCursor({
    ref: containerRef,
    pageSizes,
    scale,
    pageCursor,
    onChangePageCursor: (p) => {
      setPageCursor(p);
      if (onPageChange) {
        onPageChange({ currentPage: p, totalPages: schemasList.length });
      }
    },
  });

  const handleChangeInput = ({ name, value }: { name: string; value: string }) =>
    onChangeInput && onChangeInput({ index: unitCursor, name, value });

  const handleOnChangeRenderer = (args: { key: string; value: unknown }[], schema: SchemaForUI) => {
    let isNeedInit = false;
    let newInputValue: string | undefined;

    args.forEach(({ key: _key, value }) => {
      if (_key === 'content') {
        const newValue = value as string;
        const oldValue = (input?.[schema.name] as string) || '';
        if (newValue === oldValue) return;
        handleChangeInput({ name: schema.name, value: newValue });
        // TODO Improve this to allow schema types to determine whether the execution of getDynamicTemplate is required.
        if (schema.type === 'table') {
          isNeedInit = true;
          newInputValue = newValue;
        }
      } else {
        const targetSchema = schemasList[pageCursor].find((s) => s.id === schema.id) as SchemaForUI;
        if (!targetSchema) return;

        // @ts-expect-error Dynamic property assignment
        targetSchema[_key] = value as string;
      }
    });
    if (isNeedInit && newInputValue !== undefined) {
      // Pass the updated input directly to recalculate with new value
      const updatedInput = { ...input, [schema.name]: newInputValue };
      init(template, updatedInput);
    }
    setSchemasList([...schemasList]);
  };

  if (error) {
    return <ErrorScreen size={size} error={error} />;
  }

  return (
    <Root size={size} scale={scale}>
      <CtlBar
        size={size}
        pageCursor={pageCursor}
        pageNum={schemasList.length}
        setPageCursor={(p) => {
          if (!containerRef.current) return;
          containerRef.current.scrollTop = getPagesScrollTopByIndex(pageSizes, p, scale);
          setPageCursor(p);
          if (onPageChange) {
            onPageChange({ currentPage: p, totalPages: schemasList.length });
          }
        }}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
      />
      <UnitPager
        size={size}
        unitCursor={unitCursor}
        unitNum={inputs.length}
        setUnitCursor={setUnitCursor}
      />
      <div ref={containerRef} style={{ ...size, position: 'relative', overflow: 'auto' }}>
        <Paper
          paperRefs={paperRefs}
          scale={scale}
          size={size}
          schemasList={schemasList}
          pageSizes={pageSizes}
          backgrounds={backgrounds}
          renderSchema={({ schema, index }) => {
            const value = schema.readOnly
              ? replacePlaceholders({
                  content: schema.content || '',
                  variables: { ...input, totalPages: schemasList.length, currentPage: index + 1 },
                  schemas: schemasList,
                })
              : String((input && input[schema.name]) || '');
            return (
              <Renderer
                key={schema.id}
                schema={schema}
                basePdf={template.basePdf}
                value={value}
                textFlow={
                  isForm
                    ? textFlowController?.getBinding(
                        unitCursor,
                        schemasList.findIndex((page) => page.some((item) => item.id === schema.id)),
                        schema,
                      )
                    : undefined
                }
                mode={isForm ? 'form' : 'viewer'}
                placeholder={schema.content}
                tabIndex={index + 100}
                onChange={(arg) => {
                  const args = Array.isArray(arg) ? arg : [arg];
                  handleOnChangeRenderer(args, schema);
                }}
                outline={
                  isForm && !schema.readOnly ? `1px dashed ${token.colorPrimary}` : 'transparent'
                }
                scale={scale}
              />
            );
          }}
          renderPaper={({ index }) => (
            <StaticSchema
              template={template}
              scale={scale}
              input={input}
              totalPages={schemasList.length}
              currentPage={index + 1}
            />
          )}
        />
      </div>
    </Root>
  );
};

export default Preview;

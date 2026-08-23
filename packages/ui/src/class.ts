import ReactDOM from 'react-dom';
import { DESTROYED_ERR_MSG, DEFAULT_LANG } from './constants.js';
import { debounce } from './helper.js';
import {
  cloneDeep,
  Template,
  Size,
  Lang,
  Font,
  UIProps,
  UIOptions,
  PluginRegistry,
  PreviewProps,
  getDefaultFont,
  checkUIProps,
  checkTemplate,
  checkInputs,
  checkUIOptions,
  checkPreviewProps,
  pluginRegistry,
} from '@pdfme/common';
import { builtInPlugins } from '@pdfme/schemas';

export abstract class BaseUIClass {
  protected domContainer!: HTMLElement | null;

  protected template!: Template;

  protected size!: Size;

  private lang: Lang = DEFAULT_LANG;

  private font: Font = getDefaultFont();

  private pluginsRegistry: PluginRegistry = pluginRegistry(builtInPlugins);

  private options: UIOptions = {};

  // V5LOCK-BACKPORT-20260823-SAFARI-PINCH-STABILITY
  private hasResizeRendered = false;

  private readonly setSize = debounce((...args: unknown[]) => {
    if (!this.domContainer) {
      return;
    }

    const entries = args[0] as ResizeObserverEntry[] | undefined;
    const entry =
      entries?.find((candidate) => candidate.target === this.domContainer) ?? entries?.[0];
    const rawContentBoxSize = entry?.contentBoxSize as
      | ReadonlyArray<ResizeObserverSize>
      | ResizeObserverSize
      | undefined;
    const contentBoxSize = (
      Array.isArray(rawContentBoxSize) ? rawContentBoxSize[0] : rawContentBoxSize
    ) as ResizeObserverSize | undefined;
    const layoutWidth =
      contentBoxSize?.inlineSize ?? entry?.contentRect.width ?? this.domContainer.clientWidth;
    const layoutHeight =
      contentBoxSize?.blockSize ?? entry?.contentRect.height ?? this.domContainer.clientHeight;

    const isInitialRender = !this.hasResizeRendered;
    if (
      !isInitialRender &&
      Math.abs(this.size.width - layoutWidth) < 0.5 &&
      Math.abs(this.size.height - layoutHeight) < 0.5
    ) {
      return;
    }

    this.size = {
      height: layoutHeight,
      width: layoutWidth,
    };

    this.hasResizeRendered = true;
    this.render();
  }, 100);

  resizeObserver = new ResizeObserver(this.setSize);

  constructor(props: UIProps) {
    checkUIProps(props);

    const { domContainer, template, options = {}, plugins = {} } = props;
    this.domContainer = domContainer;
    this.template = cloneDeep(template);
    this.options = options;
    this.size = {
      height: this.domContainer.clientHeight || window.innerHeight,
      width: this.domContainer.clientWidth || window.innerWidth,
    };
    this.resizeObserver.observe(this.domContainer);

    const { lang, font } = options;
    if (lang) {
      this.lang = lang;
    }
    if (font) {
      this.font = font;
    }

    if (Object.values(plugins).length > 0) {
      this.pluginsRegistry = pluginRegistry(plugins);
    }
  }

  protected getLang() {
    return this.lang;
  }

  protected getFont() {
    return this.font;
  }

  protected getPluginsRegistry() {
    return this.pluginsRegistry;
  }

  public getOptions() {
    return this.options;
  }

  public getTemplate() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);

    return this.template;
  }

  public updateTemplate(template: Template) {
    checkTemplate(template);
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);

    this.template = cloneDeep(template);
    this.render();
  }

  public updateOptions(options: UIOptions) {
    checkUIOptions(options);
    const { lang, font } = options || {};

    if (lang) {
      this.lang = lang;
    }
    if (font) {
      this.font = font;
    }
    this.options = Object.assign(this.options, options);
    this.render();
  }

  public destroy() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    ReactDOM.unmountComponentAtNode(this.domContainer);

    this.resizeObserver.disconnect();
    this.domContainer = null;
  }

  protected abstract render(): void;
}
export abstract class PreviewUI extends BaseUIClass {
  protected inputs!: { [key: string]: string }[];

  constructor(props: PreviewProps) {
    super(props);
    checkPreviewProps(props);
    this.inputs = convertToStingObjectArray(cloneDeep(props.inputs));
  }

  public getInputs() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);

    return this.inputs;
  }

  public setInputs(inputs: { [key: string]: string }[]) {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    checkInputs(inputs);

    this.inputs = convertToStingObjectArray(inputs);
    this.render();
  }

  protected abstract render(): void;
}

type DataItem = {
  [key: string]: string | string[][];
};

type StringifiedDataItem = {
  [key: string]: string;
};

function convertToStingObjectArray(data: DataItem[]): StringifiedDataItem[] {
  return data.map((item) => {
    const stringifiedItem: StringifiedDataItem = {};
    Object.keys(item).forEach((key) => {
      const value = item[key];
      if (Array.isArray(value)) {
        stringifiedItem[key] = JSON.stringify(value);
      } else {
        stringifiedItem[key] = value;
      }
    });
    return stringifiedItem;
  });
}

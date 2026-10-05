import React from 'react';
import ReactDOM from 'react-dom';
import {
  PreviewProps,
  Template,
  UIOptions,
  hydrateTextFlowInputs,
  checkInputs,
  checkTemplate,
  checkUIOptions,
} from '@pdfme/common';
import { PreviewUI, convertToStingObjectArray } from './class.js';
import { DESTROYED_ERR_MSG } from './constants.js';
import AppContextProvider from './components/AppContextProvider.js';
import Preview from './components/Preview.js';
import { TextFlowController } from './textFlow.js';

class Form extends PreviewUI {
  private onChangeInputCallback?: (arg: { index: number; value: string; name: string }) => void;
  private onPageChangeCallback?: (pageInfo: { currentPage: number; totalPages: number }) => void;
  private pageCursor: number = 0;
  private textFlowController?: TextFlowController;

  constructor(props: PreviewProps) {
    super(props);
  }

  public onChangeInput(cb: (arg: { index: number; value: string; name: string }) => void) {
    this.onChangeInputCallback = cb;
  }

  public onPageChange(cb: (pageInfo: { currentPage: number; totalPages: number }) => void) {
    this.onPageChangeCallback = cb;
  }

  public getPageCursor() {
    return this.pageCursor;
  }

  public getTotalPages() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    return this.template.schemas.length;
  }

  public setInputs(inputs: { [key: string]: string }[]): void {
    const previousInputs = this.getInputs();
    checkInputs(inputs);
    const stringInputs = convertToStingObjectArray(inputs);
    // Reset before the render so an old provisional queue cannot reach new inputs.
    const nextInputs =
      this.getOptions().textFlow?.enabled === true
        ? hydrateTextFlowInputs(this.template, stringInputs)
        : stringInputs;
    this.textFlowController?.reset(nextInputs);
    super.setInputs(nextInputs);

    const changedInputs: Array<{ index: number; name: string; value: string }> = [];

    this.inputs.forEach((input, index) => {
      const prevInput = previousInputs[index] || {};

      const allKeys = new Set([...Object.keys(input), ...Object.keys(prevInput)]);

      allKeys.forEach((name) => {
        const newValue = input[name];
        const oldValue = prevInput[name];

        if (newValue !== oldValue) {
          changedInputs.push({ index, name, value: newValue });
        }
      });
    });

    changedInputs.forEach((input) => {
      if (this.onChangeInputCallback) {
        this.onChangeInputCallback(input);
      }
    });
  }

  /** Wait for the durable save required by any queued text-row displacement. */
  public async whenInputsSettled(): Promise<void> {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    await this.textFlowController?.whenInputsSettled();
  }

  public updateTemplate(template: Template) {
    checkTemplate(template);
    this.textFlowController?.dispose();
    this.textFlowController = undefined;
    if (this.getOptions().textFlow?.enabled === true) {
      this.inputs = hydrateTextFlowInputs(template, this.inputs);
    }
    super.updateTemplate(template);
  }

  public updateOptions(options: UIOptions) {
    checkUIOptions(options);
    if (options.textFlow?.enabled === true && this.getOptions().textFlow?.enabled !== true) {
      this.inputs = hydrateTextFlowInputs(this.template, this.inputs);
    }
    super.updateOptions(options);
  }

  public destroy() {
    this.textFlowController?.dispose();
    super.destroy();
  }

  private commitTextFlowInputs(inputs: Record<string, string>[]) {
    const changes: { index: number; name: string; value: string }[] = [];
    inputs.forEach((input, index) => {
      const previous = this.inputs[index] ?? {};
      new Set([...Object.keys(previous), ...Object.keys(input)]).forEach((name) => {
        if (previous[name] !== input[name]) changes.push({ index, name, value: input[name] ?? '' });
      });
      this.inputs[index] = { ...input };
    });
    // All fields are committed before observers read getInputs(). Keep the array
    // identity so Preview does not rebuild its schema list for ordinary typing.
    this.render();
    changes.forEach((change) => this.onChangeInputCallback?.(change));
  }

  protected render() {
    if (!this.domContainer) throw Error(DESTROYED_ERR_MSG);
    if (this.getOptions().textFlow?.enabled === true) {
      if (!this.textFlowController) {
        this.textFlowController = new TextFlowController(
          () => this.template,
          this.inputs,
          () => this.getOptions().textFlow!,
          (inputs) => this.commitTextFlowInputs(inputs),
        );
      }
    } else if (this.textFlowController) {
      this.textFlowController.dispose();
      this.textFlowController = undefined;
    }
    ReactDOM.render(
      <AppContextProvider
        lang={this.getLang()}
        font={this.getFont()}
        plugins={this.getPluginsRegistry()}
        options={this.getOptions()}
      >
        <Preview
          template={this.template}
          size={this.size}
          inputs={this.inputs}
          textFlowController={this.textFlowController}
          onChangeInput={(arg: { index: number; value: string; name: string }) => {
            const { index, value, name } = arg;
            if (this.textFlowController) {
              this.textFlowController.changeInput(index, name, value);
              return;
            }
            this.onChangeInputCallback?.({ index, value, name });
            if (this.inputs && this.inputs[index]) {
              if (this.inputs[index][name] !== value) {
                this.inputs[index][name] = value;
                this.render();
              }
            }
          }}
          onPageChange={(pageInfo) => {
            this.pageCursor = pageInfo.currentPage;
            if (this.onPageChangeCallback) {
              this.onPageChangeCallback(pageInfo);
            }
          }}
        />
      </AppContextProvider>,
      this.domContainer,
    );
  }
}

export default Form;

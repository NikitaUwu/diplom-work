import { BindingMode } from 'aurelia';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import template from './react-graph-editor.html?raw';
import GraphEditor from '../../react-editor/GraphEditor';

export class ReactGraphEditor {
  public static readonly $au = {
    type: 'custom-element',
    name: 'react-graph-editor',
    template,
    bindables: {
      chartId: { mode: BindingMode.toView },
      resultJson: { mode: BindingMode.toView },
      onResultJsonChange: { mode: BindingMode.toView },
      mode: { mode: BindingMode.toView },
      backdropImageUrl: { mode: BindingMode.toView },
      showBackdrop: { mode: BindingMode.toView },
    },
  };

  public chartId = 0;
  public resultJson: unknown = null;
  public onResultJsonChange?: (next: unknown) => void;
  public mode: 'compact' | 'full' = 'full';
  public backdropImageUrl?: string;
  public showBackdrop = false;
  public host?: HTMLDivElement;

  private root: Root | null = null;

  public attached(): void {
    if (!this.host) {
      return;
    }

    this.root = createRoot(this.host);
    this.renderReact();
  }

  public detaching(): void {
    this.root?.unmount();
    this.root = null;
  }

  public chartIdChanged(): void {
    this.renderReact();
  }

  public resultJsonChanged(): void {
    this.renderReact();
  }

  public modeChanged(): void {
    this.renderReact();
  }

  public backdropImageUrlChanged(): void {
    this.renderReact();
  }

  public showBackdropChanged(): void {
    this.renderReact();
  }

  public onResultJsonChangeChanged(): void {
    this.renderReact();
  }

  private renderReact(): void {
    if (!this.root) {
      return;
    }

    this.root.render(createElement(GraphEditor, {
      chartId: this.chartId,
      resultJson: this.resultJson,
      backdropImageUrl: this.backdropImageUrl,
      showBackdrop: this.showBackdrop,
      uiMode: this.mode,
      onResultJsonChange: (next: unknown) => this.onResultJsonChange?.(next),
    }));
  }
}

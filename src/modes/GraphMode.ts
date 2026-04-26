import type { LayoutMode, LayoutOptions } from '../types.js';

export class GraphMode {
  readonly name: LayoutMode = 'graph';
  private _active = false;
  private _options: LayoutOptions = {};

  activate(options?: LayoutOptions): void {
    this._active = true;
    this._options = options ?? {};
  }

  deactivate(): void {
    this._active = false;
  }

  isActive(): boolean {
    return this._active;
  }

  get options(): LayoutOptions {
    return this._options;
  }
}

import type { LayoutMode } from '../types.js';

export class GraphMode {
  readonly name: LayoutMode = 'graph';
  private active = false;

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

import type { LayoutMode } from '../types.js';

export class TreeMode {
  readonly name: LayoutMode = 'tree';
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

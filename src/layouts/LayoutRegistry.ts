import type { LayoutEngine } from './LayoutEngine.js';

export class LayoutRegistry {
  private layouts = new Map<string, LayoutEngine>();

  register(layout: LayoutEngine): void {
    this.layouts.set(layout.name, layout);
  }

  get(name: string): LayoutEngine | undefined {
    return this.layouts.get(name);
  }

  getAll(): LayoutEngine[] {
    return [...this.layouts.values()];
  }

  has(name: string): boolean {
    return this.layouts.has(name);
  }
}

import type { LayoutMode } from '../types.js';

interface Mode {
  name: LayoutMode;
  activate(): void;
  deactivate(): void;
}

export class ModeManager {
  private modes = new Map<LayoutMode, Mode>();
  private activeMode: LayoutMode | null = null;

  register(mode: Mode): void {
    this.modes.set(mode.name, mode);
  }

  switch(name: LayoutMode): void {
    if (this.activeMode) {
      this.modes.get(this.activeMode)?.deactivate();
    }
    this.modes.get(name)?.activate();
    this.activeMode = name;
  }

  getActive(): LayoutMode | null {
    return this.activeMode;
  }
}

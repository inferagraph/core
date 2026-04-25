import { ThemeManager } from './ThemeManager.js';

export class WebGLRenderer {
  private container: HTMLElement | null = null;
  private readonly themeManager = new ThemeManager();
  private animationFrameId: number | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
    this.themeManager.attach(container);
  }

  detach(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.container = null;
  }

  getContainer(): HTMLElement | null {
    return this.container;
  }

  getThemeManager(): ThemeManager {
    return this.themeManager;
  }

  render(): void {
    // Three.js render pass — implemented when Three.js scene is built
  }
}

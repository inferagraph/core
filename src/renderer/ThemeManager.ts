export class ThemeManager {
  private properties = new Map<string, string>();
  private container: HTMLElement | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
    this.readProperties();
  }

  getProperty(name: string): string | undefined {
    return this.properties.get(name);
  }

  getColor(name: string, fallback: string): string {
    return this.properties.get(name) ?? fallback;
  }

  private readProperties(): void {
    if (!this.container) return;
    const style = getComputedStyle(this.container);
    const props = [
      '--ig-bg-color',
      '--ig-node-color',
      '--ig-node-hover-color',
      '--ig-node-selected-color',
      '--ig-edge-color',
      '--ig-label-color',
      '--ig-label-font',
      '--ig-tooltip-bg',
      '--ig-tooltip-color',
      '--ig-panel-bg',
      '--ig-panel-color',
      '--ig-card-bg',
      '--ig-card-border',
      '--ig-card-border-radius',
      '--ig-card-shadow',
    ];
    for (const prop of props) {
      const value = style.getPropertyValue(prop).trim();
      if (value) this.properties.set(prop, value);
    }
  }

  refresh(): void {
    this.readProperties();
  }
}

import type { NodeStyle } from '../types.js';

export class LabelRenderer {
  private container: HTMLElement | null = null;
  private labels = new Map<string, HTMLElement>();
  private style: NodeStyle = 'dot';

  attach(container: HTMLElement): void {
    this.container = container;
  }

  setStyle(style: NodeStyle): void {
    const wasCustom = this.style === 'custom';
    this.style = style;

    if (style === 'custom') {
      // Hide all existing labels when switching to custom
      for (const label of this.labels.values()) {
        label.style.display = 'none';
      }
      return;
    }

    // Update CSS classes on existing labels
    for (const label of this.labels.values()) {
      if (wasCustom) {
        label.style.display = '';
      }
      label.classList.toggle('ig-label-card', style === 'card');
      label.classList.toggle('ig-label-dot', style === 'dot');
    }
  }

  getStyle(): NodeStyle {
    return this.style;
  }

  addLabel(id: string, text: string): void {
    if (!this.container) return;
    if (this.style === 'custom') return;
    const el = document.createElement('div');
    el.className = this.style === 'card' ? 'ig-label ig-label-card' : 'ig-label ig-label-dot';
    el.textContent = text;
    el.dataset.nodeId = id;
    this.container.appendChild(el);
    this.labels.set(id, el);
  }

  removeLabel(id: string): void {
    const el = this.labels.get(id);
    if (el) {
      el.remove();
      this.labels.delete(id);
    }
  }

  updatePosition(id: string, x: number, y: number): void {
    if (this.style === 'custom') return;
    const el = this.labels.get(id);
    if (!el) return;

    if (this.style === 'card') {
      // Center label on the node position
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    } else {
      // Position above/below node (original behavior)
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  getLabel(id: string): HTMLElement | undefined {
    return this.labels.get(id);
  }

  clear(): void {
    for (const el of this.labels.values()) {
      el.remove();
    }
    this.labels.clear();
  }
}

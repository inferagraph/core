export class LabelRenderer {
  private container: HTMLElement | null = null;
  private labels = new Map<string, HTMLElement>();

  attach(container: HTMLElement): void {
    this.container = container;
  }

  addLabel(id: string, text: string): void {
    if (!this.container) return;
    const el = document.createElement('div');
    el.className = 'ig-label';
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
    const el = this.labels.get(id);
    if (el) {
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  clear(): void {
    for (const el of this.labels.values()) {
      el.remove();
    }
    this.labels.clear();
  }
}

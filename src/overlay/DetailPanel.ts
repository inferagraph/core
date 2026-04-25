export class DetailPanel {
  private element: HTMLElement | null = null;

  attach(parent: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'ig-detail-panel';
    this.element.style.display = 'none';
    parent.appendChild(this.element);
  }

  show(content: string): void {
    if (!this.element) return;
    this.element.innerHTML = content;
    this.element.style.display = 'block';
  }

  hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
  }

  isVisible(): boolean {
    return this.element?.style.display !== 'none';
  }

  detach(): void {
    this.element?.remove();
    this.element = null;
  }
}

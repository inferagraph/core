export class TooltipOverlay {
  private element: HTMLElement | null = null;

  attach(parent: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'ig-tooltip';
    this.element.style.display = 'none';
    parent.appendChild(this.element);
  }

  show(content: string, x: number, y: number): void {
    if (!this.element) return;
    this.element.innerHTML = content;
    this.element.style.display = 'block';
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
  }

  hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
  }

  detach(): void {
    this.element?.remove();
    this.element = null;
  }
}

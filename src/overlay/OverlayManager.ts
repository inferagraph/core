export class OverlayManager {
  private container: HTMLElement | null = null;
  private overlayRoot: HTMLElement | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = 'ig-overlay-root';
    container.appendChild(this.overlayRoot);
  }

  getRoot(): HTMLElement | null {
    return this.overlayRoot;
  }

  detach(): void {
    this.overlayRoot?.remove();
    this.overlayRoot = null;
    this.container = null;
  }
}

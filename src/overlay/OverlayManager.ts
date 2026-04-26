export class OverlayManager {
  private _container: HTMLElement | null = null;
  private overlayRoot: HTMLElement | null = null;

  get container(): HTMLElement | null {
    return this._container;
  }

  attach(container: HTMLElement): void {
    this._container = container;
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
    this._container = null;
  }
}

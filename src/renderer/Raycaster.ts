export class Raycaster {
  private enabled = true;

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  hitTest(_x: number, _y: number): string | null {
    // Three.js raycasting — implemented with scene setup
    return null;
  }
}

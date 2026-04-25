import type { Vector3 } from '../types.js';

export class EdgeMesh {
  private source: Vector3 = { x: 0, y: 0, z: 0 };
  private target: Vector3 = { x: 0, y: 0, z: 0 };
  private color: string = '#666666';

  setPositions(source: Vector3, target: Vector3): void {
    this.source = { ...source };
    this.target = { ...target };
  }

  getSource(): Vector3 {
    return this.source;
  }

  getTarget(): Vector3 {
    return this.target;
  }

  setColor(color: string): void {
    this.color = color;
  }

  getColor(): string {
    return this.color;
  }
}

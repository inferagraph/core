import type { Vector3 } from '../types.js';

export class NodeMesh {
  private position: Vector3 = { x: 0, y: 0, z: 0 };
  private color: string = '#4a9eff';
  private radius: number = 5;

  setPosition(position: Vector3): void {
    this.position = { ...position };
  }

  getPosition(): Vector3 {
    return this.position;
  }

  setColor(color: string): void {
    this.color = color;
  }

  getColor(): string {
    return this.color;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  getRadius(): number {
    return this.radius;
  }
}

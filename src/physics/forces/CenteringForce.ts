import type { Vector3 } from '../../types.js';

export class CenteringForce {
  constructor(private strength: number = 0.01) {}

  compute(position: Vector3): Vector3 {
    return {
      x: -position.x * this.strength,
      y: -position.y * this.strength,
      z: -position.z * this.strength,
    };
  }

  setStrength(strength: number): void {
    this.strength = strength;
  }
}

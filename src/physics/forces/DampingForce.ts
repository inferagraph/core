import type { Vector3 } from '../../types.js';

export class DampingForce {
  constructor(private coefficient: number = 0.9) {}

  apply(velocity: Vector3): Vector3 {
    return {
      x: velocity.x * this.coefficient,
      y: velocity.y * this.coefficient,
      z: velocity.z * this.coefficient,
    };
  }

  setCoefficient(coefficient: number): void {
    this.coefficient = coefficient;
  }
}

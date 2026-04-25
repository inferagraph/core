import type { Vector3 } from '../../types.js';

export class SpringForce {
  constructor(
    private stiffness: number = 0.1,
    private restLength: number = 50,
  ) {}

  compute(posA: Vector3, posB: Vector3): Vector3 {
    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;
    const dz = posB.z - posA.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
    const displacement = dist - this.restLength;
    const f = this.stiffness * displacement;

    return {
      x: f * (dx / dist),
      y: f * (dy / dist),
      z: f * (dz / dist),
    };
  }

  setStiffness(stiffness: number): void {
    this.stiffness = stiffness;
  }

  setRestLength(restLength: number): void {
    this.restLength = restLength;
  }
}

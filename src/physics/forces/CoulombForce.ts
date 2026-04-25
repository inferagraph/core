import type { Vector3 } from '../../types.js';

export class CoulombForce {
  constructor(private strength: number = 100) {}

  compute(posA: Vector3, posB: Vector3): Vector3 {
    const dx = posA.x - posB.x;
    const dy = posA.y - posB.y;
    const dz = posA.z - posB.z;
    const distSq = dx * dx + dy * dy + dz * dz + 0.01;
    const dist = Math.sqrt(distSq);
    const f = this.strength / distSq;

    return {
      x: f * (dx / dist),
      y: f * (dy / dist),
      z: f * (dz / dist),
    };
  }

  setStrength(strength: number): void {
    this.strength = strength;
  }
}

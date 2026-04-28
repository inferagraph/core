import type { Vector3 } from '../../types.js';

export class SpringForce {
  constructor(
    /**
     * Hooke's-law stiffness applied to the (dist - restLength) displacement.
     * Lowered from 0.1 → 0.05 in 0.1.11 because real-world graphs have many
     * bidirectional edges (A→B and B→A), so each connected pair was getting
     * two springs and effectively double the attractive force, crushing the
     * cluster into a tight ball. ForceSimulation now also dedupes
     * bidirectional pairs before handing edges to the spring, but a softer
     * spring still produces a more readable spread for densely-connected
     * subgraphs.
     */
    private stiffness: number = 0.05,
    /**
     * Equilibrium distance between connected nodes. 50 was too tight for the
     * default node radius + label sizing; bumped to 80 in 0.1.11 so labels
     * can breathe.
     */
    private restLength: number = 80,
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

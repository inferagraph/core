import type { Vector3 } from '../../types.js';

/**
 * Pulls every node back toward the origin with a force proportional to its
 * distance from origin. Acts as a "tether" that:
 *   1. Bounds the simulation — without it, mutually-repelling disconnected
 *      clusters drift apart forever.
 *   2. Anchors orphans — a node with no edges has no spring to anchor it,
 *      so without a centering force it would drift to the simulation
 *      periphery driven by Coulomb repulsion alone. The centering force
 *      keeps disconnected nodes in the visible region of the canvas.
 *
 * The strength is intentionally weak (0.005) so it doesn't fight the spring
 * + repulsion equilibrium for a connected cluster — just nudges everything
 * gently toward (0, 0, 0).
 */
export class CenteringForce {
  constructor(private strength: number = 0.005) {}

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

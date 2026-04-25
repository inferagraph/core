import { describe, it, expect } from 'vitest';
import { BarnesHut } from '../../src/physics/BarnesHut.js';

describe('BarnesHut', () => {
  it('should build tree from positions', () => {
    const bh = new BarnesHut();
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 0, y: 100, z: 0 },
    ];
    const tree = bh.buildTree(positions, [1, 1, 1]);
    expect(tree.mass).toBe(3);
  });

  it('should compute repulsive force', () => {
    const bh = new BarnesHut();
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const tree = bh.buildTree(positions, [1, 1]);
    const force = bh.computeForce(tree, { x: 5, y: 0, z: 0 }, 100);
    expect(typeof force.x).toBe('number');
    expect(typeof force.y).toBe('number');
    expect(typeof force.z).toBe('number');
  });

  it('should handle empty positions', () => {
    const bh = new BarnesHut();
    const tree = bh.buildTree([], []);
    expect(tree.mass).toBe(0);
  });
});

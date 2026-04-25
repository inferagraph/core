import { describe, it, expect } from 'vitest';
import { ForceSimulation } from '../../src/physics/ForceSimulation.js';

describe('ForceSimulation', () => {
  it('should initialize with nodes', () => {
    const sim = new ForceSimulation();
    sim.setNodes(['1', '2', '3']);
    const positions = sim.getPositions();
    expect(positions.size).toBe(3);
  });

  it('should tick without error', () => {
    const sim = new ForceSimulation();
    sim.setNodes(['1', '2']);
    sim.setEdges([{ sourceId: '1', targetId: '2' }]);
    expect(() => sim.tick()).not.toThrow();
  });

  it('should move nodes after tick', () => {
    const sim = new ForceSimulation();
    sim.setNodes(['1', '2']);
    sim.setEdges([{ sourceId: '1', targetId: '2' }]);
    const before = sim.getPositions();
    const pos1Before = before.get('1')!;
    sim.tick();
    const after = sim.getPositions();
    const pos1After = after.get('1')!;
    const moved = pos1Before.x !== pos1After.x || pos1Before.y !== pos1After.y || pos1Before.z !== pos1After.z;
    expect(moved).toBe(true);
  });

  it('should track running state', () => {
    const sim = new ForceSimulation();
    expect(sim.isRunning()).toBe(false);
    sim.start();
    expect(sim.isRunning()).toBe(true);
    sim.stop();
    expect(sim.isRunning()).toBe(false);
  });
});

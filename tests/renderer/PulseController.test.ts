import { describe, it, expect, vi, beforeEach } from 'vitest';

// PulseController doesn't import THREE directly, but it does call
// NodeMesh.updateInstance which does. Mock just enough so the chain runs.
vi.mock('three', () => {
  // Minimal geometry mock — needs `setAttribute` so NodeMesh can attach
  // its `instanceAlpha` buffer at construction time.
  const makeGeometry = () => {
    const attributes: Record<string, unknown> = {};
    return {
      attributes,
      setAttribute: vi.fn().mockImplementation((name: string, attr: unknown) => {
        attributes[name] = attr;
      }),
      getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
      dispose: vi.fn(),
    };
  };
  return {
    Vector3: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x?: number, y?: number, z?: number) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
      return this;
    }),
    Quaternion: vi.fn().mockImplementation(() => ({})),
    Matrix4: vi.fn().mockImplementation(() => ({ compose: vi.fn().mockReturnThis() })),
    Color: vi.fn().mockImplementation(() => ({})),
    SphereGeometry: vi.fn().mockImplementation(() => makeGeometry()),
    ShapeGeometry: vi.fn().mockImplementation(() => makeGeometry()),
    Shape: vi.fn().mockImplementation(() => ({
      moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(),
    })),
    MeshPhongMaterial: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    InstancedMesh: vi.fn().mockImplementation((_g, _m, count) => ({
      count,
      instanceMatrix: { needsUpdate: false },
      instanceColor: { needsUpdate: false },
      setMatrixAt: vi.fn(),
      setColorAt: vi.fn(),
      geometry: { dispose: vi.fn() },
      material: { dispose: vi.fn() },
    })),
    InstancedBufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
      array: arr,
      itemSize: size,
      needsUpdate: false,
    })),
  };
});

import { PulseController } from '../../src/renderer/PulseController.js';
import { NodeMesh } from '../../src/renderer/NodeMesh.js';

describe('PulseController', () => {
  describe('configuration', () => {
    it('defaults to enabled with sane period + amplitude', () => {
      const p = new PulseController();
      const cfg = p.getConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.period).toBe(2500);
      expect(cfg.amplitude).toBe(0.06);
    });

    it('false disables pulsing', () => {
      const p = new PulseController(false);
      expect(p.isEnabled()).toBe(false);
    });

    it('true uses defaults', () => {
      const p = new PulseController(true);
      expect(p.isEnabled()).toBe(true);
      expect(p.getConfig().period).toBe(2500);
    });

    it('partial config overrides defaults', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.2 });
      expect(p.getConfig().period).toBe(1000);
      expect(p.getConfig().amplitude).toBe(0.2);
      expect(p.getConfig().enabled).toBe(true);
    });

    it('setConfig replaces the configuration', () => {
      const p = new PulseController();
      p.setConfig(false);
      expect(p.isEnabled()).toBe(false);
      p.setConfig({ period: 100 });
      expect(p.isEnabled()).toBe(true);
      expect(p.getConfig().period).toBe(100);
    });
  });

  describe('phase offsets', () => {
    it('returns deterministic offsets in [0, 2π)', () => {
      const p = new PulseController();
      const a = p.phaseFor('node-a');
      const a2 = p.phaseFor('node-a');
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
      expect(a2).toBe(a);
    });

    it('two different ids almost always produce different phases', () => {
      const p = new PulseController();
      const a = p.phaseFor('alpha');
      const b = p.phaseFor('beta');
      expect(a).not.toBe(b);
    });
  });

  describe('computeScale', () => {
    it('returns 1 when disabled', () => {
      const p = new PulseController(false);
      expect(p.computeScale('x', 0)).toBe(1);
      expect(p.computeScale('x', 1234)).toBe(1);
    });

    it('returns 1 + amplitude * sin(phase) when enabled', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.1, now: () => 0 });
      const scale = p.computeScale('node-x', 0);
      // Just bounded check — sine of (phaseOffset) ∈ [-1, 1].
      expect(scale).toBeGreaterThanOrEqual(0.9);
      expect(scale).toBeLessThanOrEqual(1.1);
    });

    it('varies over time for the same node', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.5 });
      const a = p.computeScale('id', 0);
      const b = p.computeScale('id', 250); // quarter cycle later
      expect(a).not.toBe(b);
    });

    it('highlighted nodes pulse with multiplied amplitude', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.1, highlightMultiplier: 4 });
      const restingMax = 1 + 0.1;
      const highlightedMax = 1 + 0.1 * 4;
      // Sample many times across one period; the highlighted maximum
      // should exceed the resting maximum.
      let restingSeen = 1;
      let highlightedSeen = 1;
      for (let t = 0; t < 1000; t += 10) {
        restingSeen = Math.max(restingSeen, p.computeScale('id', t, false));
        highlightedSeen = Math.max(highlightedSeen, p.computeScale('id', t, true));
      }
      expect(restingSeen).toBeLessThanOrEqual(restingMax + 1e-9);
      expect(highlightedSeen).toBeGreaterThan(restingMax);
      expect(highlightedSeen).toBeLessThanOrEqual(highlightedMax + 1e-9);
    });
  });

  describe('computeColor', () => {
    it('returns the base colour when colorAmplitude is 0', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.1 });
      expect(p.computeColor('id', '#3D8DAF', 0)).toBe('#3D8DAF');
    });

    it('lifts the lightness when colorAmplitude > 0', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.1, colorAmplitude: 0.2 });
      // Sample multiple times — at least one frame should produce a
      // brighter colour than the base.
      let saw = false;
      for (let t = 0; t < 1000; t += 50) {
        const c = p.computeColor('id', '#3D8DAF', t);
        if (c !== '#3D8DAF' && c !== '#3d8daf') {
          saw = true;
          break;
        }
      }
      expect(saw).toBe(true);
    });
  });

  describe('apply', () => {
    let mesh: NodeMesh;
    let updateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mesh = new NodeMesh();
      mesh.createInstancedMesh(3);
      mesh.setRadius(5);
      updateSpy = vi.spyOn(mesh, 'updateInstance');
    });

    it('does nothing when disabled', () => {
      const p = new PulseController(false);
      p.apply(mesh, ['a', 'b', 'c'], new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 1, y: 1, z: 1 }],
        ['c', { x: 2, y: 2, z: 2 }],
      ]), ['#111111', '#222222', '#333333']);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('writes a new transform per non-excluded node', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.1, now: () => 100 });
      p.apply(mesh, ['a', 'b', 'c'], new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 1, y: 1, z: 1 }],
        ['c', { x: 2, y: 2, z: 2 }],
      ]), ['#111111', '#222222', '#333333']);
      expect(updateSpy).toHaveBeenCalledTimes(3);
    });

    it('skips the excluded (hovered) index', () => {
      const p = new PulseController({ period: 1000, amplitude: 0.1, now: () => 100 });
      p.setExcludedIndex(1);
      p.apply(mesh, ['a', 'b', 'c'], new Map([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 1, y: 1, z: 1 }],
        ['c', { x: 2, y: 2, z: 2 }],
      ]), ['#111111', '#222222', '#333333']);
      expect(updateSpy).toHaveBeenCalledTimes(2);
      const indices = updateSpy.mock.calls.map((c) => c[0]);
      expect(indices).toEqual([0, 2]);
    });

    it('produces different scales across consecutive frames', () => {
      let now = 0;
      const p = new PulseController({ period: 1000, amplitude: 0.5, now: () => now });
      p.apply(mesh, ['a'], new Map([['a', { x: 0, y: 0, z: 0 }]]), ['#111111']);
      const firstScale = updateSpy.mock.calls[0][3];
      now = 250; // quarter cycle later
      updateSpy.mockClear();
      p.apply(mesh, ['a'], new Map([['a', { x: 0, y: 0, z: 0 }]]), ['#111111']);
      const secondScale = updateSpy.mock.calls[0][3];
      expect(firstScale).not.toBe(secondScale);
    });
  });

  describe('reset', () => {
    it('clears the phase cache and exclude index', () => {
      const p = new PulseController();
      p.phaseFor('id-1');
      p.setExcludedIndex(7);
      p.reset();
      expect(p.getExcludedIndex()).toBeNull();
    });
  });
});

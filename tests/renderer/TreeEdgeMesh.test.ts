import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => {
  const Color = vi.fn().mockImplementation(function (
    this: { r: number; g: number; b: number; set: (s: string) => unknown },
    hex?: string,
  ) {
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.set = vi.fn().mockImplementation((value: string) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(value).trim());
      if (m) {
        const v = parseInt(m[1], 16);
        this.r = ((v >> 16) & 0xff) / 255;
        this.g = ((v >> 8) & 0xff) / 255;
        this.b = (v & 0xff) / 255;
      }
      return this;
    });
    if (hex) (this.set as (s: string) => unknown)(hex);
    return this;
  });

  const makeAttribute = (arr: Float32Array, size: number) => ({
    array: arr,
    itemSize: size,
    needsUpdate: false,
  });

  return {
    Color,
    BufferGeometry: vi.fn().mockImplementation(() => {
      const attributes: Record<string, ReturnType<typeof makeAttribute>> = {};
      return {
        setAttribute: vi.fn().mockImplementation(
          (name: string, attr: ReturnType<typeof makeAttribute>) => {
            attributes[name] = attr;
          },
        ),
        getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
        setDrawRange: vi.fn(),
        dispose: vi.fn(),
      };
    }),
    Float32BufferAttribute: vi.fn().mockImplementation(makeAttribute),
    LineBasicMaterial: vi.fn().mockImplementation((opts: Record<string, unknown> = {}) => ({
      dispose: vi.fn(),
      vertexColors: opts.vertexColors,
      transparent: opts.transparent,
      opacity: opts.opacity,
    })),
    LineSegments: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
      type: 'LineSegments',
    })),
  };
});

import { TreeEdgeMesh, type TreeEdgeSegment } from '../../src/renderer/TreeEdgeMesh.js';

const sampleSegments: TreeEdgeSegment[] = [
  // marriage line
  { a: { x: 0, y: 100, z: 0 }, b: { x: 100, y: 100, z: 0 }, color: '#a1a1aa' },
  // sibling bar
  { a: { x: 25, y: 50, z: 0 }, b: { x: 75, y: 50, z: 0 }, color: '#a1a1aa' },
  // parent-to-bar drop
  { a: { x: 50, y: 100, z: 0 }, b: { x: 50, y: 50, z: 0 }, color: '#ff00ff' },
];

describe('TreeEdgeMesh', () => {
  let mesh: TreeEdgeMesh;

  beforeEach(() => {
    mesh = new TreeEdgeMesh();
  });

  describe('build', () => {
    it('produces a single LineSegments mesh holding all segments', () => {
      mesh.build(sampleSegments);
      const result = mesh.getMesh();
      expect(result).not.toBeNull();
      expect((result as { type: string }).type).toBe('LineSegments');
      expect(mesh.getSegmentCount()).toBe(sampleSegments.length);
    });

    it('writes 2 vertices × 3 floats per segment into the position buffer', () => {
      mesh.build(sampleSegments);
      const result = mesh.getMesh() as { geometry: { getAttribute: (n: string) => { array: Float32Array; itemSize: number } } };
      const positions = result.geometry.getAttribute('position');
      expect(positions.itemSize).toBe(3);
      // First segment vertices.
      expect(positions.array[0]).toBeCloseTo(sampleSegments[0].a.x);
      expect(positions.array[1]).toBeCloseTo(sampleSegments[0].a.y);
      expect(positions.array[2]).toBeCloseTo(sampleSegments[0].a.z);
      expect(positions.array[3]).toBeCloseTo(sampleSegments[0].b.x);
      expect(positions.array[4]).toBeCloseTo(sampleSegments[0].b.y);
      expect(positions.array[5]).toBeCloseTo(sampleSegments[0].b.z);
    });

    it('writes the per-segment colour to both endpoints (vertex-colour attribute)', () => {
      mesh.build(sampleSegments);
      const result = mesh.getMesh() as { geometry: { getAttribute: (n: string) => { array: Float32Array; itemSize: number } } };
      const colors = result.geometry.getAttribute('color');
      expect(colors.itemSize).toBe(3);
      // Third segment uses #ff00ff → r=1, g=0, b=1.
      const offset = 2 * 6; // segment index 2, 6 floats per segment.
      expect(colors.array[offset + 0]).toBeCloseTo(1, 5);
      expect(colors.array[offset + 1]).toBeCloseTo(0, 5);
      expect(colors.array[offset + 2]).toBeCloseTo(1, 5);
      expect(colors.array[offset + 3]).toBeCloseTo(1, 5);
      expect(colors.array[offset + 4]).toBeCloseTo(0, 5);
      expect(colors.array[offset + 5]).toBeCloseTo(1, 5);
    });

    it('uses a translucent vertex-coloured LineBasicMaterial', () => {
      mesh.build(sampleSegments);
      const result = mesh.getMesh() as { material: { vertexColors: boolean; transparent: boolean; opacity: number } };
      expect(result.material.vertexColors).toBe(true);
      expect(result.material.transparent).toBe(true);
      expect(result.material.opacity).toBeGreaterThan(0);
      expect(result.material.opacity).toBeLessThan(1);
    });

    it('rebuilding replaces the prior LineSegments', () => {
      mesh.build(sampleSegments.slice(0, 1));
      const first = mesh.getMesh();
      mesh.build(sampleSegments);
      const second = mesh.getMesh();
      expect(second).not.toBe(first);
      expect(mesh.getSegmentCount()).toBe(sampleSegments.length);
    });

    it('handles an empty segment list without throwing', () => {
      expect(() => mesh.build([])).not.toThrow();
      expect(mesh.getSegmentCount()).toBe(0);
    });
  });

  describe('setOpacity', () => {
    it('overrides the connector opacity for the next build', () => {
      mesh.setOpacity(0.7);
      mesh.build(sampleSegments);
      const result = mesh.getMesh() as { material: { opacity: number } };
      expect(result.material.opacity).toBeCloseTo(0.7, 5);
    });
  });

  describe('dispose', () => {
    it('clears the mesh and resets the segment count', () => {
      mesh.build(sampleSegments);
      mesh.dispose();
      expect(mesh.getMesh()).toBeNull();
      expect(mesh.getSegmentCount()).toBe(0);
    });

    it('is safe to call repeatedly', () => {
      mesh.build(sampleSegments);
      mesh.dispose();
      expect(() => mesh.dispose()).not.toThrow();
    });

    it('is safe to call before build', () => {
      expect(() => mesh.dispose()).not.toThrow();
    });
  });
});

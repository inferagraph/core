import { describe, it, expect, beforeEach, vi } from 'vitest';

// Headless three.js mock — only the surface InferredEdgeMesh touches.
// Mirrors the existing EdgeMesh / SceneController test mocks so the
// fragment is recognisable to anyone navigating between them.
vi.mock('three', () => {
  const Color = vi.fn().mockImplementation(function (this: { r: number; g: number; b: number; set: (s: string) => unknown }, hex?: string) {
    this.r = 0; this.g = 0; this.b = 0;
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

  type Attr = { array: Float32Array; itemSize: number; needsUpdate: boolean };
  return {
    Color,
    BufferGeometry: vi.fn().mockImplementation(() => {
      const attributes: Record<string, Attr> = {};
      return {
        setAttribute: vi.fn().mockImplementation((name: string, attr: Attr) => {
          attributes[name] = attr;
        }),
        getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
        dispose: vi.fn(),
      };
    }),
    LineDashedMaterial: vi.fn().mockImplementation((opts) => ({
      color: opts?.color,
      dashSize: opts?.dashSize,
      gapSize: opts?.gapSize,
      transparent: opts?.transparent,
      opacity: opts?.opacity,
      depthWrite: opts?.depthWrite,
      dispose: vi.fn(),
    })),
    LineSegments: vi.fn().mockImplementation(function (this: object, geo: unknown, mat: unknown) {
      const self = this as Record<string, unknown>;
      self.geometry = geo;
      self.material = mat;
      self.visible = true;
      self.computeLineDistances = vi.fn();
      return this;
    }),
    Float32BufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
      array: arr,
      itemSize: size,
      needsUpdate: false,
    })),
  };
});

import {
  InferredEdgeMesh,
  INFERRED_EDGE_DASH_SIZE,
  INFERRED_EDGE_GAP_SIZE,
  INFERRED_EDGE_ALPHA,
  INFERRED_EDGE_COLOR,
} from '../../src/renderer/InferredEdgeMesh.js';
import type { InferredEdge } from '../../src/ai/InferredEdge.js';
import type { Vector3 } from '../../src/types.js';

function makeEdge(sourceId: string, targetId: string, type = 'related_to', score = 0.5): InferredEdge {
  return {
    sourceId,
    targetId,
    type,
    score,
    sources: ['graph'],
  };
}

function makePositions(entries: Array<[string, Vector3]>): ReadonlyMap<string, Vector3> {
  return new Map(entries);
}

describe('InferredEdgeMesh', () => {
  let mesh: InferredEdgeMesh;

  beforeEach(() => {
    mesh = new InferredEdgeMesh();
  });

  describe('construction defaults', () => {
    it('starts with no mesh allocated', () => {
      expect(mesh.getMesh()).toBeNull();
      expect(mesh.getMaterial()).toBeNull();
      expect(mesh.getSegmentCount()).toBe(0);
      expect(mesh.getEdges()).toEqual([]);
    });

    it('starts hidden by default (matches the `showInferredEdges=false` plan default)', () => {
      expect(mesh.isVisible()).toBe(false);
    });
  });

  describe('setInferredEdges — building the line geometry', () => {
    it('builds a LineSegments mesh sized to the edge count', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
        ['c', { x: 20, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b'), makeEdge('b', 'c')], positions);
      expect(mesh.getMesh()).not.toBeNull();
      expect(mesh.getSegmentCount()).toBe(2);
    });

    it('writes endpoint coordinates into the position buffer', () => {
      const positions = makePositions([
        ['a', { x: 1, y: 2, z: 3 }],
        ['b', { x: 4, y: 5, z: 6 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      const geometry = (mesh.getMesh() as unknown as { geometry: unknown }).geometry as {
        getAttribute: (name: string) => { array: Float32Array };
      };
      const positionAttr = geometry.getAttribute('position');
      expect(Array.from(positionAttr.array.slice(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('uses LineDashedMaterial with the locked dash + gap constants', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      const material = mesh.getMaterial() as unknown as {
        dashSize: number;
        gapSize: number;
      };
      expect(material.dashSize).toBe(INFERRED_EDGE_DASH_SIZE);
      expect(material.gapSize).toBe(INFERRED_EDGE_GAP_SIZE);
      // Sanity-check the constants themselves match the Phase 5 plan.
      expect(INFERRED_EDGE_DASH_SIZE).toBe(6);
      expect(INFERRED_EDGE_GAP_SIZE).toBe(4);
    });

    it('uses alpha 0.30 (between explicit 0.55 and dimmed 0.15)', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      const material = mesh.getMaterial() as unknown as { opacity: number; transparent: boolean };
      expect(material.opacity).toBe(INFERRED_EDGE_ALPHA);
      expect(INFERRED_EDGE_ALPHA).toBeCloseTo(0.3, 5);
      expect(material.transparent).toBe(true);
    });

    it('uses the locked color #8a92b2 (matches EdgeMesh default)', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      expect(INFERRED_EDGE_COLOR).toBe('#8a92b2');
      const material = mesh.getMaterial() as unknown as { color: string };
      expect(material.color).toBe('#8a92b2');
    });

    it('calls computeLineDistances so the dashed material renders correctly', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      const lineMesh = mesh.getMesh() as unknown as { computeLineDistances: ReturnType<typeof vi.fn> };
      expect(lineMesh.computeLineDistances).toHaveBeenCalled();
    });

    it('drops edges whose endpoints are missing from the positions map', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      // 'c' has no position — the edge a→c should be dropped.
      mesh.setInferredEdges(
        [makeEdge('a', 'b'), makeEdge('a', 'c')],
        positions,
      );
      expect(mesh.getSegmentCount()).toBe(1);
      expect(mesh.getEdges()).toHaveLength(1);
      expect(mesh.getEdges()[0]?.targetId).toBe('b');
    });

    it('handles the zero-edges case by tearing down without throwing', () => {
      const positions = makePositions([['a', { x: 0, y: 0, z: 0 }]]);
      // Build something first so we can verify dispose runs.
      mesh.setInferredEdges(
        [makeEdge('a', 'a')], // self-loop, both endpoints exist
        positions,
      );
      expect(mesh.getMesh()).not.toBeNull();
      // Now empty.
      mesh.setInferredEdges([], positions);
      expect(mesh.getMesh()).toBeNull();
      expect(mesh.getSegmentCount()).toBe(0);
      expect(mesh.getEdges()).toEqual([]);
    });

    it('replaces previous geometry on each call (no incremental merge)', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
        ['c', { x: 20, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      mesh.setInferredEdges([makeEdge('a', 'c'), makeEdge('b', 'c')], positions);
      expect(mesh.getSegmentCount()).toBe(2);
      // The first edge a→b is gone; only the second batch survives.
      const ids = mesh.getEdges().map((e) => `${e.sourceId}→${e.targetId}`);
      expect(ids).toEqual(['a→c', 'b→c']);
    });
  });

  describe('setVisibility — overlay toggle', () => {
    it('sets the underlying mesh visible flag without rebuilding', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      const before = mesh.getMesh();
      mesh.setVisibility(true);
      expect(mesh.isVisible()).toBe(true);
      expect((before as unknown as { visible: boolean }).visible).toBe(true);
      // Same mesh instance — no rebuild.
      expect(mesh.getMesh()).toBe(before);
    });

    it('persists the cached visibility across rebuilds', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setVisibility(true);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      expect((mesh.getMesh() as unknown as { visible: boolean }).visible).toBe(true);
    });

    it('is safe to call before any edges have been pushed', () => {
      expect(() => mesh.setVisibility(true)).not.toThrow();
      expect(mesh.isVisible()).toBe(true);
    });
  });

  describe('dispose', () => {
    it('frees geometry and material', () => {
      const positions = makePositions([
        ['a', { x: 0, y: 0, z: 0 }],
        ['b', { x: 10, y: 0, z: 0 }],
      ]);
      mesh.setInferredEdges([makeEdge('a', 'b')], positions);
      const geo = (mesh.getMesh() as unknown as { geometry: { dispose: ReturnType<typeof vi.fn> } }).geometry;
      const mat = (mesh.getMesh() as unknown as { material: { dispose: ReturnType<typeof vi.fn> } }).material;
      mesh.dispose();
      expect(geo.dispose).toHaveBeenCalled();
      expect(mat.dispose).toHaveBeenCalled();
      expect(mesh.getMesh()).toBeNull();
      expect(mesh.getMaterial()).toBeNull();
      expect(mesh.getSegmentCount()).toBe(0);
    });

    it('is idempotent', () => {
      mesh.dispose();
      expect(() => mesh.dispose()).not.toThrow();
    });
  });
});

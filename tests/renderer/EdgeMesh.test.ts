import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => {
  const Color = vi.fn().mockImplementation(function (this: { r: number; g: number; b: number; set: (s: string) => unknown }, hex?: string) {
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.set = vi.fn().mockImplementation((value: string) => {
      // Parse simple #rrggbb hex strings into 0..1 RGB so test assertions
      // can check that setSegmentColor wrote the right channels.
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

  // Buffer attribute mock — itemSize is whatever the caller passes
  // through `Float32BufferAttribute(arr, size)`, so position (3) and
  // colour (4) attributes can coexist in the same fake geometry.
  type Attr = { array: Float32Array; itemSize: number; needsUpdate: boolean };

  return {
    BufferGeometry: vi.fn().mockImplementation(() => {
      const attributes: Record<string, Attr> = {};
      return {
        setAttribute: vi.fn().mockImplementation((name: string, attr: Attr) => {
          attributes[name] = attr;
        }),
        getAttribute: vi.fn().mockImplementation((name: string) => attributes[name]),
        dispose: vi.fn(),
        setDrawRange: vi.fn(),
      };
    }),
    LineBasicMaterial: vi.fn().mockImplementation((opts) => ({
      dispose: vi.fn(),
      color: { set: vi.fn() },
      vertexColors: opts?.vertexColors,
      transparent: opts?.transparent,
      opacity: opts?.opacity,
    })),
    LineSegments: vi.fn().mockImplementation((geo, mat) => ({
      geometry: geo,
      material: mat,
    })),
    Float32BufferAttribute: vi.fn().mockImplementation((arr: Float32Array, size: number) => ({
      array: arr,
      itemSize: size,
      needsUpdate: false,
    })),
    Color,
  };
});

import { EdgeMesh } from '../../src/renderer/EdgeMesh.js';

describe('EdgeMesh', () => {
  let mesh: EdgeMesh;

  beforeEach(() => {
    mesh = new EdgeMesh();
  });

  describe('data properties (backward compatibility)', () => {
    it('should set and get positions', () => {
      mesh.setPositions({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
      expect(mesh.getSource()).toEqual({ x: 1, y: 2, z: 3 });
      expect(mesh.getTarget()).toEqual({ x: 4, y: 5, z: 6 });
    });

    it('should default positions to origin', () => {
      expect(mesh.getSource()).toEqual({ x: 0, y: 0, z: 0 });
      expect(mesh.getTarget()).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('should set and get color', () => {
      mesh.setColor('#ff0000');
      expect(mesh.getColor()).toBe('#ff0000');
    });

    it('should default color to #8a92b2', () => {
      expect(mesh.getColor()).toBe('#8a92b2');
    });
  });

  describe('Three.js integration', () => {
    it('should return null mesh before creation', () => {
      expect(mesh.getMesh()).toBeNull();
    });

    it('should create line segments', () => {
      mesh.createLineSegments(10);
      expect(mesh.getMesh()).not.toBeNull();
    });

    it('reports the segment count after creation', () => {
      expect(mesh.getSegmentCount()).toBe(0);
      mesh.createLineSegments(7);
      expect(mesh.getSegmentCount()).toBe(7);
    });

    it('should update segment positions', () => {
      mesh.createLineSegments(10);
      const source = { x: 1, y: 2, z: 3 };
      const target = { x: 4, y: 5, z: 6 };
      mesh.updateSegment(0, source, target);

      // The getAttribute mock returns an array that should be updated
      const threeMesh = mesh.getMesh();
      expect(threeMesh).not.toBeNull();
    });

    it('should not throw when updating segment with no mesh', () => {
      expect(() =>
        mesh.updateSegment(0, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }),
      ).not.toThrow();
    });

    it('should dispose geometry and material', () => {
      mesh.createLineSegments(10);
      mesh.dispose();
      expect(mesh.getMesh()).toBeNull();
      expect(mesh.getSegmentCount()).toBe(0);
    });

    it('should dispose previous mesh when creating new one', () => {
      mesh.createLineSegments(5);
      const firstMesh = mesh.getMesh();
      expect(firstMesh).not.toBeNull();

      mesh.createLineSegments(10);
      const secondMesh = mesh.getMesh();
      expect(secondMesh).not.toBeNull();
    });

    it('should create geometry with correct buffer size', () => {
      mesh.createLineSegments(10);
      const threeMesh = mesh.getMesh();
      expect(threeMesh).not.toBeNull();
      // geometry.setAttribute should have been called with position attribute
      expect(threeMesh!.geometry.setAttribute).toHaveBeenCalled();
    });

    it('uses vertexColors so per-edge colours render through the shared mesh', () => {
      mesh.createLineSegments(3);
      const threeMesh = mesh.getMesh() as unknown as {
        material: { vertexColors?: boolean };
      } | null;
      expect(threeMesh?.material?.vertexColors).toBe(true);
    });

    it('writes both endpoints of a segment when setSegmentColor is called', () => {
      mesh.createLineSegments(2);
      mesh.setSegmentColor(1, '#ff0000');

      const threeMesh = mesh.getMesh()!;
      const colorAttr = threeMesh.geometry.getAttribute('color') as unknown as {
        array: Float32Array;
        needsUpdate: boolean;
        itemSize: number;
      };
      // Layout: 4 components per vertex (rgba), 2 vertices per segment.
      // Segment index 1 → offset 8..15. Both endpoints should be
      // (r=1, g=0, b=0, a=preserved). Pre-fill leaves alpha at 1.
      expect(colorAttr.itemSize).toBe(4);
      expect(colorAttr.array[8]).toBeCloseTo(1, 5);
      expect(colorAttr.array[9]).toBeCloseTo(0, 5);
      expect(colorAttr.array[10]).toBeCloseTo(0, 5);
      expect(colorAttr.array[11]).toBeCloseTo(1, 5); // alpha preserved
      expect(colorAttr.array[12]).toBeCloseTo(1, 5);
      expect(colorAttr.array[13]).toBeCloseTo(0, 5);
      expect(colorAttr.array[14]).toBeCloseTo(0, 5);
      expect(colorAttr.array[15]).toBeCloseTo(1, 5); // alpha preserved
      expect(colorAttr.needsUpdate).toBe(true);
    });

    it('setSegmentColor is a no-op when index is out of range', () => {
      mesh.createLineSegments(2);
      expect(() => mesh.setSegmentColor(5, '#ff0000')).not.toThrow();
    });

    it('setSegmentColor is a no-op before createLineSegments', () => {
      expect(() => mesh.setSegmentColor(0, '#ff0000')).not.toThrow();
    });

    it('setSegmentAlpha writes alpha to both endpoints of a segment', () => {
      mesh.createLineSegments(3);
      mesh.setSegmentAlpha(2, 0);
      const threeMesh = mesh.getMesh()!;
      const colorAttr = threeMesh.geometry.getAttribute('color') as unknown as {
        array: Float32Array;
        needsUpdate: boolean;
      };
      // Segment index 2 → offset 16..23. Alpha lives at offsets 19, 23.
      expect(colorAttr.array[19]).toBeCloseTo(0, 5);
      expect(colorAttr.array[23]).toBeCloseTo(0, 5);
      expect(colorAttr.needsUpdate).toBe(true);
    });

    it('setVisibility hides edges whose ids are not in the visible set', () => {
      mesh.createLineSegments(3);
      mesh.setEdgeIds(['e0', 'e1', 'e2']);
      mesh.setVisibility(new Set(['e0', 'e2']));
      const threeMesh = mesh.getMesh()!;
      const colorAttr = threeMesh.geometry.getAttribute('color') as unknown as {
        array: Float32Array;
      };
      // e0 visible: alpha=1 at offsets 3 + 7
      expect(colorAttr.array[3]).toBeCloseTo(1, 5);
      expect(colorAttr.array[7]).toBeCloseTo(1, 5);
      // e1 hidden: alpha=0 at offsets 11 + 15
      expect(colorAttr.array[11]).toBeCloseTo(0, 5);
      expect(colorAttr.array[15]).toBeCloseTo(0, 5);
      // e2 visible: alpha=1 at offsets 19 + 23
      expect(colorAttr.array[19]).toBeCloseTo(1, 5);
      expect(colorAttr.array[23]).toBeCloseTo(1, 5);
    });

    it('setVisibility is a no-op when edge ids have not been registered', () => {
      mesh.createLineSegments(2);
      // No setEdgeIds — should not throw and should leave alpha at 1.
      expect(() => mesh.setVisibility(new Set(['e0']))).not.toThrow();
      const threeMesh = mesh.getMesh()!;
      const colorAttr = threeMesh.geometry.getAttribute('color') as unknown as {
        array: Float32Array;
      };
      expect(colorAttr.array[3]).toBeCloseTo(1, 5);
      expect(colorAttr.array[7]).toBeCloseTo(1, 5);
    });
  });
});

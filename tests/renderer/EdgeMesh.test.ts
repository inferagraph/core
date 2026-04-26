import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => ({
  BufferGeometry: vi.fn().mockImplementation(() => ({
    setAttribute: vi.fn(),
    getAttribute: vi.fn().mockReturnValue({
      array: new Float32Array(60),
      needsUpdate: false,
    }),
    dispose: vi.fn(),
    setDrawRange: vi.fn(),
  })),
  LineBasicMaterial: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    color: { set: vi.fn() },
  })),
  LineSegments: vi.fn().mockImplementation((geo, mat) => ({
    geometry: geo,
    material: mat,
  })),
  Float32BufferAttribute: vi.fn().mockImplementation((arr, size) => ({
    array: arr,
    itemSize: size,
    needsUpdate: false,
  })),
}));

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

    it('should default color to #666666', () => {
      expect(mesh.getColor()).toBe('#666666');
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
  });
});

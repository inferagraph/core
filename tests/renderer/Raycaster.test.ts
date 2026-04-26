import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIntersectObjects = vi.fn().mockReturnValue([]);
const mockSetFromCamera = vi.fn();

vi.mock('three', () => ({
  Raycaster: vi.fn().mockImplementation(() => ({
    setFromCamera: mockSetFromCamera,
    intersectObjects: mockIntersectObjects,
  })),
  Vector2: vi.fn().mockImplementation((x, y) => ({ x: x ?? 0, y: y ?? 0 })),
  PerspectiveCamera: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn(), x: 0, y: 0, z: 0 },
    aspect: 1,
    updateProjectionMatrix: vi.fn(),
  })),
}));

import { Raycaster } from '../../src/renderer/Raycaster.js';
import * as THREE from 'three';

describe('Raycaster', () => {
  let raycaster: Raycaster;

  beforeEach(() => {
    raycaster = new Raycaster();
    mockIntersectObjects.mockReturnValue([]);
    mockSetFromCamera.mockClear();
  });

  describe('enable/disable', () => {
    it('should be enabled by default', () => {
      expect(raycaster.isEnabled()).toBe(true);
    });

    it('should disable', () => {
      raycaster.disable();
      expect(raycaster.isEnabled()).toBe(false);
    });

    it('should re-enable', () => {
      raycaster.disable();
      raycaster.enable();
      expect(raycaster.isEnabled()).toBe(true);
    });

    it('should return null when disabled', () => {
      raycaster.disable();
      expect(raycaster.hitTest(100, 100, 800, 600)).toBeNull();
    });
  });

  describe('hitTest', () => {
    it('should return null when no camera is set', () => {
      expect(raycaster.hitTest(100, 100, 800, 600)).toBeNull();
    });

    it('should return null when no objects are set', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      expect(raycaster.hitTest(100, 100, 800, 600)).toBeNull();
    });

    it('should return null when no intersections found', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      raycaster.setObjects([{} as THREE.Object3D]);
      raycaster.setNodeIds(['node-1']);

      mockIntersectObjects.mockReturnValue([]);
      expect(raycaster.hitTest(100, 100, 800, 600)).toBeNull();
    });

    it('should return node ID when intersection has instanceId', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      raycaster.setObjects([{} as THREE.Object3D]);
      raycaster.setNodeIds(['node-a', 'node-b', 'node-c']);

      mockIntersectObjects.mockReturnValue([
        { instanceId: 1, distance: 10 },
      ]);

      const result = raycaster.hitTest(400, 300, 800, 600);
      expect(result).toBe('node-b');
    });

    it('should return null when instanceId exceeds node IDs length', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      raycaster.setObjects([{} as THREE.Object3D]);
      raycaster.setNodeIds(['node-a']);

      mockIntersectObjects.mockReturnValue([
        { instanceId: 5, distance: 10 },
      ]);

      const result = raycaster.hitTest(400, 300, 800, 600);
      expect(result).toBeNull();
    });

    it('should convert screen coordinates to NDC', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      raycaster.setObjects([{} as THREE.Object3D]);

      raycaster.hitTest(400, 300, 800, 600);

      // NDC: x = (400/800)*2 - 1 = 0, y = -(300/600)*2 + 1 = 0
      expect(mockSetFromCamera).toHaveBeenCalled();
    });

    it('should use raw coordinates when width/height not provided', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      raycaster.setObjects([{} as THREE.Object3D]);

      raycaster.hitTest(0.5, -0.5);

      expect(mockSetFromCamera).toHaveBeenCalled();
    });

    it('should return null when intersection has no instanceId', () => {
      const camera = new THREE.PerspectiveCamera();
      raycaster.setCamera(camera);
      raycaster.setObjects([{} as THREE.Object3D]);
      raycaster.setNodeIds(['node-a']);

      mockIntersectObjects.mockReturnValue([
        { distance: 10 },
      ]);

      const result = raycaster.hitTest(400, 300, 800, 600);
      expect(result).toBeNull();
    });
  });
});

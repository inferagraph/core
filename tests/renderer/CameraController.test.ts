import { describe, it, expect, vi, beforeEach } from 'vitest';

// CameraController now wraps TrackballControls; mock both so jsdom stays happy.

vi.mock('three', () => {
  function Vector3(this: { x: number; y: number; z: number }, x?: number, y?: number, z?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = z ?? 0;
    const self = this as unknown as Record<string, unknown>;
    self.set = vi.fn().mockImplementation((nx: number, ny: number, nz: number) => {
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    });
    self.lengthSq = vi.fn().mockImplementation(() => this.x * this.x + this.y * this.y + this.z * this.z);
    self.length = vi.fn().mockImplementation(() => Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z));
    self.setLength = vi.fn().mockImplementation((len: number) => {
      const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
      const k = len / l;
      this.x *= k;
      this.y *= k;
      this.z *= k;
      return this;
    });
    self.distanceTo = vi.fn().mockReturnValue(100);
    self.clone = vi.fn().mockImplementation(() => new (Vector3 as unknown as new (a: number, b: number, c: number) => unknown)(this.x, this.y, this.z));
    self.copy = vi.fn().mockImplementation((v: { x: number; y: number; z: number }) => {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    });
    return this;
  }
  return {
    PerspectiveCamera: vi.fn().mockImplementation(() => ({
      position: {
        set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
          this.x = x; this.y = y; this.z = z;
          return this;
        }),
        x: 0, y: 0, z: 200,
        clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 200 }),
        distanceTo: vi.fn().mockReturnValue(100),
        copy: vi.fn().mockReturnThis(),
      },
      up: { x: 0, y: 1, z: 0, clone: vi.fn().mockReturnValue({ x: 0, y: 1, z: 0 }), copy: vi.fn().mockReturnThis() },
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
      lookAt: vi.fn(),
    })),
    Vector3: Vector3 as unknown,
  };
});

const trackballInstances: Array<Record<string, unknown>> = [];
let lastTrackball: Record<string, unknown> | null = null;

vi.mock('three/examples/jsm/controls/TrackballControls.js', () => ({
  TrackballControls: vi.fn().mockImplementation((camera: unknown, dom: HTMLElement) => {
    const instance = {
      camera,
      domElement: dom,
      target: {
        x: 0, y: 0, z: 0,
        set: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
          this.x = x; this.y = y; this.z = z;
          return this;
        }),
        clone: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, copy: vi.fn().mockReturnThis() }),
        copy: vi.fn().mockReturnThis(),
      },
      rotateSpeed: 1,
      zoomSpeed: 1,
      panSpeed: 1,
      dynamicDampingFactor: 0,
      noRotate: false,
      update: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      handleResize: vi.fn(),
    };
    trackballInstances.push(instance);
    lastTrackball = instance;
    return instance;
  }),
}));

import { CameraController } from '../../src/renderer/CameraController.js';
import * as THREE from 'three';

describe('CameraController (TrackballControls-backed)', () => {
  let controller: CameraController;
  let container: HTMLElement;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    trackballInstances.length = 0;
    lastTrackball = null;
    controller = new CameraController();
    container = document.createElement('div');
    camera = new THREE.PerspectiveCamera();
  });

  describe('attach/detach', () => {
    it('constructs a TrackballControls bound to the camera + container', () => {
      controller.attach(container, camera);
      expect(lastTrackball).not.toBeNull();
      expect(lastTrackball!.camera).toBe(camera);
      expect(lastTrackball!.domElement).toBe(container);
    });

    it('disposes the controls on detach', () => {
      controller.attach(container, camera);
      const disposeSpy = lastTrackball!.dispose as ReturnType<typeof vi.fn>;
      controller.detach();
      expect(disposeSpy).toHaveBeenCalled();
      expect(controller.getControls()).toBeNull();
    });

    it('detach without prior attach is a no-op', () => {
      expect(() => controller.detach()).not.toThrow();
    });

    it('exposes the underlying TrackballControls', () => {
      controller.attach(container, camera);
      expect(controller.getControls()).toBe(lastTrackball);
    });
  });

  describe('target', () => {
    it('defaults target to origin', () => {
      expect(controller.getTarget()).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('forwards setTarget into the controls.target', () => {
      controller.attach(container, camera);
      controller.setTarget({ x: 10, y: 20, z: 30 });
      const t = lastTrackball!.target as { x: number; y: number; z: number };
      expect(t.x).toBe(10);
      expect(t.y).toBe(20);
      expect(t.z).toBe(30);
    });

    it('returns a copy of the controls target via getTarget', () => {
      controller.attach(container, camera);
      controller.setTarget({ x: 1, y: 2, z: 3 });
      const t = controller.getTarget();
      t.x = 999;
      expect(controller.getTarget().x).toBe(1);
    });
  });

  describe('radius', () => {
    it('exposes a default radius', () => {
      expect(controller.getRadius()).toBeGreaterThan(0);
    });

    it('setRadius positions the camera at the requested distance', () => {
      controller.attach(container, camera);
      const setSpy = camera.position.set as ReturnType<typeof vi.fn>;
      setSpy.mockClear();
      controller.setRadius(500);
      expect(setSpy).toHaveBeenCalled();
    });

    it('setRadius clamps to a minimum of 1', () => {
      controller.attach(container, camera);
      controller.setRadius(0);
      // After clamping the radius should be 1, not 0.
      // We can't read it directly when controls present (it computes
      // distanceTo on the camera mock, which returns 100), so detach to
      // fall back on the internal value.
      controller.detach();
      expect(controller.getRadius()).toBe(1);
    });
  });

  describe('rotation control', () => {
    it('setRotationEnabled(false) sets noRotate=true on the controls', () => {
      controller.attach(container, camera);
      controller.setRotationEnabled(false);
      expect(lastTrackball!.noRotate).toBe(true);
    });

    it('setRotationEnabled(true) re-enables rotation', () => {
      controller.attach(container, camera);
      controller.setRotationEnabled(false);
      controller.setRotationEnabled(true);
      expect(lastTrackball!.noRotate).toBe(false);
    });

    it('setRotationEnabled is a no-op when not attached', () => {
      expect(() => controller.setRotationEnabled(false)).not.toThrow();
    });

    it('resetRotation calls controls.reset()', () => {
      controller.attach(container, camera);
      const resetSpy = lastTrackball!.reset as ReturnType<typeof vi.fn>;
      controller.resetRotation();
      expect(resetSpy).toHaveBeenCalled();
    });

    it('resetRotation is a no-op when not attached', () => {
      expect(() => controller.resetRotation()).not.toThrow();
    });
  });

  describe('update', () => {
    it('forwards update() to the trackball controls', () => {
      controller.attach(container, camera);
      const spy = lastTrackball!.update as ReturnType<typeof vi.fn>;
      spy.mockClear();
      controller.update();
      expect(spy).toHaveBeenCalled();
    });

    it('update without controls is a no-op', () => {
      expect(() => controller.update()).not.toThrow();
    });
  });
});

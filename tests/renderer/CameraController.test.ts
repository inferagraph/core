import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => ({
  PerspectiveCamera: vi.fn().mockImplementation(() => ({
    position: {
      set: vi.fn(),
      x: 0,
      y: 0,
      z: 0,
    },
    aspect: 1,
    updateProjectionMatrix: vi.fn(),
    lookAt: vi.fn(),
    getWorldDirection: vi.fn().mockReturnValue({ x: 0, y: 0, z: -1 }),
    matrixWorld: {
      elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
    },
  })),
  Vector3: vi.fn().mockImplementation((x, y, z) => ({
    x: x ?? 0,
    y: y ?? 0,
    z: z ?? 0,
    set: vi.fn(),
    setFromMatrixColumn: vi.fn().mockReturnThis(),
  })),
}));

import { CameraController } from '../../src/renderer/CameraController.js';
import * as THREE from 'three';

describe('CameraController', () => {
  let controller: CameraController;
  let container: HTMLElement;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    controller = new CameraController();
    container = document.createElement('div');
    camera = new THREE.PerspectiveCamera();
  });

  describe('attach/detach', () => {
    it('should attach to container and camera', () => {
      const addSpy = vi.spyOn(container, 'addEventListener');
      controller.attach(container, camera);

      // Should register mousedown, mousemove, mouseup, wheel, contextmenu
      expect(addSpy).toHaveBeenCalledTimes(5);
      expect(addSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
      expect(addSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function));
    });

    it('should remove event listeners on detach', () => {
      const removeSpy = vi.spyOn(container, 'removeEventListener');
      controller.attach(container, camera);
      controller.detach();

      expect(removeSpy).toHaveBeenCalledTimes(5);
      expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function));
    });

    it('should not throw when detaching without attach', () => {
      expect(() => controller.detach()).not.toThrow();
    });
  });

  describe('target', () => {
    it('should default target to origin', () => {
      expect(controller.getTarget()).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('should set and get target', () => {
      controller.attach(container, camera);
      controller.setTarget({ x: 10, y: 20, z: 30 });
      expect(controller.getTarget()).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('should return a copy of target', () => {
      controller.setTarget({ x: 1, y: 2, z: 3 });
      const target = controller.getTarget();
      target.x = 999;
      expect(controller.getTarget().x).toBe(1);
    });
  });

  describe('update', () => {
    it('should update camera position on update()', () => {
      controller.attach(container, camera);
      controller.update();
      expect(camera.position.set).toHaveBeenCalled();
      expect(camera.lookAt).toHaveBeenCalled();
    });
  });

  describe('mouse interactions', () => {
    it('should handle orbit rotation on left mouse drag', () => {
      controller.attach(container, camera);

      const mousedown = new MouseEvent('mousedown', {
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      container.dispatchEvent(mousedown);

      const mousemove = new MouseEvent('mousemove', {
        clientX: 110,
        clientY: 105,
      });
      container.dispatchEvent(mousemove);

      // Camera should have been updated
      expect(camera.position.set).toHaveBeenCalled();

      const mouseup = new MouseEvent('mouseup', { button: 0 });
      container.dispatchEvent(mouseup);
    });

    it('should handle zoom on wheel', () => {
      controller.attach(container, camera);

      const wheel = new WheelEvent('wheel', { deltaY: 100 });
      container.dispatchEvent(wheel);

      expect(camera.position.set).toHaveBeenCalled();
    });

    it('should handle pan on right-click drag', () => {
      controller.attach(container, camera);

      const mousedown = new MouseEvent('mousedown', {
        button: 2,
        clientX: 100,
        clientY: 100,
      });
      container.dispatchEvent(mousedown);

      const mousemove = new MouseEvent('mousemove', {
        clientX: 110,
        clientY: 105,
      });
      container.dispatchEvent(mousemove);

      expect(camera.position.set).toHaveBeenCalled();

      const mouseup = new MouseEvent('mouseup', { button: 2 });
      container.dispatchEvent(mouseup);
    });

    it('should handle pan on shift+left-click drag', () => {
      controller.attach(container, camera);

      const mousedown = new MouseEvent('mousedown', {
        button: 0,
        shiftKey: true,
        clientX: 100,
        clientY: 100,
      });
      container.dispatchEvent(mousedown);

      const mousemove = new MouseEvent('mousemove', {
        clientX: 110,
        clientY: 105,
      });
      container.dispatchEvent(mousemove);

      expect(camera.position.set).toHaveBeenCalled();

      const mouseup = new MouseEvent('mouseup', { button: 0 });
      container.dispatchEvent(mouseup);
    });

    it('should prevent context menu', () => {
      controller.attach(container, camera);

      const contextmenu = new Event('contextmenu', { cancelable: true });
      const preventSpy = vi.spyOn(contextmenu, 'preventDefault');
      container.dispatchEvent(contextmenu);

      expect(preventSpy).toHaveBeenCalled();
    });
  });
});

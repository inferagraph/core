import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../../src/renderer/CameraController.js';

/**
 * Drive the camera controller's update loop manually with a fake clock
 * so we can verify the focus animation transitions over the expected
 * duration without relying on real timers.
 */
describe('CameraController.focusOn', () => {
  let container: HTMLElement;
  let camera: THREE.PerspectiveCamera;
  let controller: CameraController;
  let nowValue = 0;
  const realNow = performance.now;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    camera.position.set(0, 0, 100);
    controller = new CameraController();
    controller.attach(container, camera);
    // Override performance.now so the animation tick is deterministic.
    nowValue = 0;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => nowValue,
    });
  });

  afterEach(() => {
    controller.detach();
    container.remove();
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: realNow,
    });
  });

  it('starts an animation when focusOn is called', () => {
    expect(controller.isFocusAnimationActive()).toBe(false);
    controller.focusOn({ x: 50, y: 0, z: 0 });
    expect(controller.isFocusAnimationActive()).toBe(true);
  });

  it('completes after the configured duration', () => {
    controller.focusOn({ x: 100, y: 0, z: 0 }, { duration: 600, radius: 50 });
    nowValue = 0;
    controller.update();
    expect(controller.isFocusAnimationActive()).toBe(true);

    nowValue = 300;
    controller.update();
    // Mid-animation: target should be partway between 0 and 100.
    const mid = controller.getTarget();
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100);

    nowValue = 600;
    controller.update();
    const end = controller.getTarget();
    expect(end.x).toBeCloseTo(100);
    expect(controller.isFocusAnimationActive()).toBe(false);
  });

  it('animates the radius toward the target radius', () => {
    controller.setRadius(200);
    controller.focusOn({ x: 0, y: 0, z: 0 }, { duration: 400, radius: 50 });

    nowValue = 0;
    controller.update();
    expect(controller.getRadius()).toBeGreaterThan(50);

    nowValue = 400;
    controller.update();
    expect(controller.getRadius()).toBeCloseTo(50, 1);
  });

  it('retargets smoothly mid-animation', () => {
    controller.focusOn({ x: 100, y: 0, z: 0 }, { duration: 600 });
    nowValue = 300;
    controller.update();
    const mid = controller.getTarget();

    // Retarget to a different point.
    controller.focusOn({ x: -50, y: 0, z: 0 }, { duration: 200 });
    expect(controller.isFocusAnimationActive()).toBe(true);
    // The new "from" should be the live target (mid), not 0.
    nowValue = 300; // start of new animation
    controller.update();
    const newStart = controller.getTarget();
    // Within tolerance, should equal `mid` (we just set the new
    // animation, no time elapsed yet).
    expect(newStart.x).toBeCloseTo(mid.x, 1);

    nowValue = 500; // end of new animation
    controller.update();
    expect(controller.getTarget().x).toBeCloseTo(-50, 1);
  });

  it('cancelFocus stops an in-flight animation', () => {
    controller.focusOn({ x: 100, y: 0, z: 0 });
    expect(controller.isFocusAnimationActive()).toBe(true);
    controller.cancelFocus();
    expect(controller.isFocusAnimationActive()).toBe(false);
  });

  it('focusOn before attach is a no-op', () => {
    const c = new CameraController();
    expect(() => c.focusOn({ x: 1, y: 2, z: 3 })).not.toThrow();
    expect(c.isFocusAnimationActive()).toBe(false);
  });
});

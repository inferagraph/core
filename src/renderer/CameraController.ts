import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import type { Vector3 } from '../types.js';

/**
 * Wraps Three.js's `TrackballControls` so the rest of InferaGraph can use a
 * stable, narrow API:
 *
 *   - `attach(container, camera)` / `detach()`
 *   - `setTarget` / `getTarget`
 *   - `setRadius` / `getRadius`
 *   - `setRotationEnabled` / `resetRotation`
 *   - `swapCamera(newCamera)` — used when toggling between graph
 *     (perspective) and tree (orthographic) views.
 *   - `update()` (called from the SceneController's per-frame tick)
 *
 * Trackball gives the user full 3-axis rotation (pitch + yaw + roll) — a
 * hard requirement for the graph view. The previous spherical-orbit
 * implementation could not roll around the look axis.
 */
export class CameraController {
  private container: HTMLElement | null = null;
  private camera: THREE.Camera | null = null;
  private controls: TrackballControls | null = null;
  private target: Vector3 = { x: 0, y: 0, z: 0 };

  /** Default orbit distance — used until `setRadius` is called. */
  private radius = 100;

  /** Captured initial camera state for `resetRotation()`. */
  private initialPosition: THREE.Vector3 | null = null;
  private initialUp: THREE.Vector3 | null = null;
  private initialTarget: THREE.Vector3 | null = null;

  attach(container: HTMLElement, camera: THREE.Camera): void {
    this.container = container;
    this.camera = camera;

    // Position the camera at the configured radius along its current look
    // direction (so the first frame frames the scene).
    this.placeCameraAtRadius();

    this.controls = new TrackballControls(camera, container);
    this.controls.target.set(this.target.x, this.target.y, this.target.z);
    this.controls.rotateSpeed = 3.0;   // a touch quicker than the default 1.0
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.dynamicDampingFactor = 0.2;

    // Capture the initial state so `resetRotation()` is meaningful.
    this.initialPosition = camera.position.clone();
    this.initialUp = camera.up.clone();
    this.initialTarget = this.controls.target.clone();
  }

  detach(): void {
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    this.container = null;
    this.camera = null;
    this.initialPosition = null;
    this.initialUp = null;
    this.initialTarget = null;
  }

  /**
   * Swap in a new camera (e.g. switching from PerspectiveCamera in graph
   * view to OrthographicCamera in tree view). Recreates the underlying
   * TrackballControls so gestures bind to the new camera. The previous
   * radius and target are preserved.
   */
  swapCamera(camera: THREE.Camera): void {
    if (!this.container) {
      this.camera = camera;
      return;
    }
    const previousRadius = this.radius;
    const previousTarget = { ...this.target };

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    this.camera = camera;
    this.placeCameraAtRadius();

    this.controls = new TrackballControls(camera, this.container);
    this.controls.target.set(previousTarget.x, previousTarget.y, previousTarget.z);
    this.controls.rotateSpeed = 3.0;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.dynamicDampingFactor = 0.2;

    this.initialPosition = camera.position.clone();
    this.initialUp = camera.up.clone();
    this.initialTarget = this.controls.target.clone();
    this.radius = previousRadius;
  }

  /** The active camera. */
  getCamera(): THREE.Camera | null {
    return this.camera;
  }

  setTarget(position: Vector3): void {
    this.target = { ...position };
    if (this.controls) {
      this.controls.target.set(position.x, position.y, position.z);
    }
    this.placeCameraAtRadius();
  }

  getTarget(): Vector3 {
    if (this.controls) {
      return {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z,
      };
    }
    return { ...this.target };
  }

  /** Override the orbit radius (distance from the target). */
  setRadius(radius: number): void {
    this.radius = Math.max(1, radius);
    this.placeCameraAtRadius();
  }

  getRadius(): number {
    if (this.camera && this.controls) {
      return this.camera.position.distanceTo(this.controls.target);
    }
    return this.radius;
  }

  /**
   * Pump the underlying TrackballControls. SceneController calls this from
   * its per-frame tick so damping continues to interpolate even when the
   * pointer is idle.
   */
  update(): void {
    this.controls?.update();
  }

  /**
   * Toggle rotation gestures (pitch + yaw + roll). Zoom + pan stay live so
   * users can still navigate while rotation is locked (e.g. during a
   * scripted camera animation).
   */
  setRotationEnabled(enabled: boolean): void {
    if (!this.controls) return;
    this.controls.noRotate = !enabled;
  }

  /**
   * Snap the camera back to the orientation captured at `attach()` time.
   * Preserves the current orbit radius if `keepRadius` is true (default).
   */
  resetRotation(keepRadius = true): void {
    if (!this.controls || !this.camera || !this.initialPosition || !this.initialUp || !this.initialTarget) {
      return;
    }
    const previousRadius = this.getRadius();
    this.controls.reset();
    // `controls.reset()` drops the camera back at its initial position,
    // which also resets the orbit distance. Re-apply the user's radius if
    // requested.
    if (keepRadius) {
      this.setRadius(previousRadius);
    }
  }

  /**
   * Expose the underlying TrackballControls for advanced consumers / tests.
   */
  getControls(): TrackballControls | null {
    return this.controls;
  }

  /**
   * Position the camera at `this.radius` units from the target, along the
   * current look direction. If the camera is currently coincident with the
   * target, default to the +Z axis so we don't divide by zero.
   */
  private placeCameraAtRadius(): void {
    if (!this.camera) return;
    const t = this.target;
    const eye = new THREE.Vector3(
      this.camera.position.x - t.x,
      this.camera.position.y - t.y,
      this.camera.position.z - t.z,
    );
    if (eye.lengthSq() < 1e-6) {
      eye.set(0, 0, 1);
    }
    eye.setLength(this.radius);
    this.camera.position.set(t.x + eye.x, t.y + eye.y, t.z + eye.z);
    this.camera.lookAt(new THREE.Vector3(t.x, t.y, t.z));
  }
}

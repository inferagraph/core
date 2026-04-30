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

  /**
   * Active focus animation, if any. Updated every frame by
   * {@link tickFocus} (called from SceneController's tick). `null` when
   * no animation is running. Calling {@link focusOn} mid-animation
   * smoothly retargets — the new animation interpolates from the
   * current live state, not from the previous animation's start.
   */
  private focusAnimation: FocusAnimation | null = null;

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
    this.tickFocus();
    this.controls?.update();
  }

  /**
   * Begin (or retarget) a smooth-eased animation of the camera to focus
   * on `target`. The animation:
   *   - Lerps the orbit target from its current value to `target` over
   *     `duration` ms (default 600ms).
   *   - Lerps the orbit radius from its current value to `radius`
   *     (default = current radius * 0.6 — frames the focused node and
   *     its 1-hop neighbourhood without excessive zoom).
   *   - Uses cubic in/out easing.
   *
   * Calling `focusOn` mid-animation resets the animation's start state
   * to the live camera + the previous animation's progress is dropped.
   * The result is a smooth retarget without any discontinuity.
   *
   * No-op when not attached.
   */
  focusOn(
    target: Vector3,
    options?: { duration?: number; radius?: number },
  ): void {
    if (!this.camera || !this.controls) return;
    const duration = Math.max(1, options?.duration ?? 600);
    const liveTarget = this.getTarget();
    const liveRadius = this.getRadius();
    const targetRadius = options?.radius ?? Math.max(20, liveRadius * 0.6);

    this.focusAnimation = {
      startTime: now(),
      duration,
      fromTarget: { ...liveTarget },
      toTarget: { ...target },
      fromRadius: liveRadius,
      toRadius: targetRadius,
    };
  }

  /**
   * `true` when {@link focusOn} has scheduled an animation that hasn't
   * yet completed. Exposed for tests + advanced consumers; the renderer
   * itself just calls {@link update} each frame.
   */
  isFocusAnimationActive(): boolean {
    return this.focusAnimation !== null;
  }

  /**
   * Advance the active focus animation by one frame. Pure interpolation
   * + write-through — no allocation in the hot path. Resolves and
   * clears the animation when it reaches t=1.
   */
  private tickFocus(): void {
    const anim = this.focusAnimation;
    if (!anim) return;
    if (!this.camera || !this.controls) {
      this.focusAnimation = null;
      return;
    }
    const elapsed = now() - anim.startTime;
    const t = Math.min(1, Math.max(0, elapsed / anim.duration));
    const eased = easeInOutCubic(t);

    const tx = lerp(anim.fromTarget.x, anim.toTarget.x, eased);
    const ty = lerp(anim.fromTarget.y, anim.toTarget.y, eased);
    const tz = lerp(anim.fromTarget.z, anim.toTarget.z, eased);
    const r = lerp(anim.fromRadius, anim.toRadius, eased);

    this.target = { x: tx, y: ty, z: tz };
    this.controls.target.set(tx, ty, tz);
    this.radius = Math.max(1, r);
    this.placeCameraAtRadius();

    if (t >= 1) {
      this.focusAnimation = null;
    }
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
   * Whether rotation gestures are currently active. Mirrors the underlying
   * trackball's `noRotate` flag (inverted). Returns `true` when not yet
   * attached so the default reflects the constructor state.
   */
  isRotationEnabled(): boolean {
    if (!this.controls) return true;
    return !this.controls.noRotate;
  }

  /**
   * Snap the active camera back to an axis-aligned, front-facing
   * orientation. Used by the tree view so any prior trackball rotation
   * cannot carry over and skew the orthographic projection.
   *
   *   - position = target + (0, 0, radius)  (along +Z)
   *   - up       = (0, 1, 0)
   *   - lookAt(target)
   *
   * The radius is preserved (mid-tree zoom level survives the reset).
   * Pan target also survives — only the orientation + camera location
   * relative to the target are rewritten.
   */
  resetCameraOrientation(): void {
    if (!this.camera) return;
    const t = this.target;
    const radius = this.radius;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(t.x, t.y, t.z + radius);
    this.camera.lookAt(new THREE.Vector3(t.x, t.y, t.z));
    if (this.controls) {
      this.controls.target.set(t.x, t.y, t.z);
    }
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
   * Re-derive the controller's internal state from whatever transform the
   * camera + controls.target currently hold.
   *
   * Background: SceneController persists per-mode camera snapshots and
   * restores them by writing directly onto `camera.position` /
   * `camera.quaternion` / `controls.target`. That bypasses the controller's
   * cached `radius` field AND any residual TrackballControls damping
   * (`_lastAngle`, `_movePrev/_moveCurr`, `_panStart/_panEnd`,
   * `_zoomStart/_zoomEnd`). On the next per-frame `update()` the
   * trackball's own `_eye` is recomputed from the live transform — that
   * part is fine — but residual damping then nudges the camera away from
   * the just-restored snapshot, undoing the persistence.
   *
   * This method:
   *   1. Recomputes `radius = camera.position.distanceTo(target)` so the
   *      controller's stored radius matches the live state.
   *   2. Zeros every TrackballControls damping accumulator so the next
   *      `update()` is a no-op (no rotation, no zoom, no pan applied).
   *   3. Resyncs the controls' `_lastPosition` / `_lastZoom` so the change
   *      detector inside `update()` doesn't fire spurious change events.
   *
   * Safe to call when not attached (no-op).
   */
  syncFromCamera(): void {
    if (!this.camera || !this.controls) return;

    // 1. Refresh our cached target + radius from the live transform.
    const cam = this.camera as THREE.Camera & {
      position: { x: number; y: number; z: number };
      zoom?: number;
    };
    this.target = {
      x: this.controls.target.x,
      y: this.controls.target.y,
      z: this.controls.target.z,
    };
    const dx = cam.position.x - this.target.x;
    const dy = cam.position.y - this.target.y;
    const dz = cam.position.z - this.target.z;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (Number.isFinite(r) && r > 0) {
      this.radius = r;
    }

    // 2. Zero any residual damping inside the underlying TrackballControls.
    //    These fields are public properties of the JS implementation
    //    (despite the leading underscore) — the trackball itself reads +
    //    writes them as plain object slots, so we can do the same.
    const c = this.controls as unknown as {
      _lastAngle?: number;
      _movePrev?: { x: number; y: number; copy?: (v: { x: number; y: number }) => unknown };
      _moveCurr?: { x: number; y: number };
      _panStart?: { x: number; y: number; copy?: (v: { x: number; y: number }) => unknown };
      _panEnd?: { x: number; y: number };
      _zoomStart?: { x: number; y: number; copy?: (v: { x: number; y: number }) => unknown };
      _zoomEnd?: { x: number; y: number };
      _touchZoomDistanceStart?: number;
      _touchZoomDistanceEnd?: number;
      _lastPosition?: {
        copy?: (v: { x: number; y: number; z: number }) => unknown;
      };
      _lastZoom?: number;
    };
    if (typeof c._lastAngle === 'number') c._lastAngle = 0;
    if (c._movePrev?.copy && c._moveCurr) c._movePrev.copy(c._moveCurr);
    if (c._panStart?.copy && c._panEnd) c._panStart.copy(c._panEnd);
    if (c._zoomStart?.copy && c._zoomEnd) c._zoomStart.copy(c._zoomEnd);
    if (typeof c._touchZoomDistanceStart === 'number' &&
        typeof c._touchZoomDistanceEnd === 'number') {
      c._touchZoomDistanceStart = c._touchZoomDistanceEnd;
    }

    // 3. Sync the change-detector slots so the very next update() doesn't
    //    fire a redundant `change` event from the position+zoom delta we
    //    just introduced.
    if (c._lastPosition?.copy) c._lastPosition.copy(cam.position);
    if (typeof c._lastZoom === 'number' && typeof cam.zoom === 'number') {
      c._lastZoom = cam.zoom;
    }
  }

  /**
   * Cancel any active focus animation. Used by SceneController when an
   * external action (mode toggle, syncFromStore) supersedes a pending
   * focus.
   */
  cancelFocus(): void {
    this.focusAnimation = null;
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

/** Interpolation state for an active focus animation. */
interface FocusAnimation {
  startTime: number;
  duration: number;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromRadius: number;
  toRadius: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth in/out cubic easing. Identity at t=0 and t=1, accelerates from
 * 0 to 0.5, decelerates from 0.5 to 1.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Monotonic time source. Uses `performance.now()` when available (jsdom +
 * browsers), falls back to `Date.now()` (older Node test runtimes).
 */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

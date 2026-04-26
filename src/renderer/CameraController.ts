import * as THREE from 'three';
import type { Vector3 } from '../types.js';

export class CameraController {
  private container: HTMLElement | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private target: Vector3 = { x: 0, y: 0, z: 0 };

  // Spherical coordinates for orbit
  private spherical = { radius: 100, phi: Math.PI / 3, theta: 0 };

  // Interaction state
  private isRotating = false;
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Sensitivity settings
  private rotateSpeed = 0.005;
  private zoomSpeed = 0.1;
  private panSpeed = 0.5;

  // Bound event handlers (so we can remove them)
  private onMouseDownBound = this.onMouseDown.bind(this);
  private onMouseMoveBound = this.onMouseMove.bind(this);
  private onMouseUpBound = this.onMouseUp.bind(this);
  private onWheelBound = this.onWheel.bind(this);
  private onContextMenuBound = this.onContextMenu.bind(this);

  attach(container: HTMLElement, camera: THREE.PerspectiveCamera): void {
    this.container = container;
    this.camera = camera;

    container.addEventListener('mousedown', this.onMouseDownBound);
    container.addEventListener('mousemove', this.onMouseMoveBound);
    container.addEventListener('mouseup', this.onMouseUpBound);
    container.addEventListener('wheel', this.onWheelBound, { passive: false });
    container.addEventListener('contextmenu', this.onContextMenuBound);

    this.updateCameraPosition();
  }

  detach(): void {
    if (this.container) {
      this.container.removeEventListener('mousedown', this.onMouseDownBound);
      this.container.removeEventListener('mousemove', this.onMouseMoveBound);
      this.container.removeEventListener('mouseup', this.onMouseUpBound);
      this.container.removeEventListener('wheel', this.onWheelBound);
      this.container.removeEventListener('contextmenu', this.onContextMenuBound);
    }
    this.container = null;
    this.camera = null;
    this.isRotating = false;
    this.isPanning = false;
  }

  setTarget(position: Vector3): void {
    this.target = { ...position };
    this.updateCameraPosition();
  }

  getTarget(): Vector3 {
    return { ...this.target };
  }

  update(): void {
    this.updateCameraPosition();
  }

  private updateCameraPosition(): void {
    if (!this.camera) return;

    // Clamp phi to avoid gimbal lock
    this.spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.spherical.phi));
    this.spherical.radius = Math.max(1, this.spherical.radius);

    // Convert spherical to Cartesian
    const x = this.spherical.radius * Math.sin(this.spherical.phi) * Math.sin(this.spherical.theta);
    const y = this.spherical.radius * Math.cos(this.spherical.phi);
    const z = this.spherical.radius * Math.sin(this.spherical.phi) * Math.cos(this.spherical.theta);

    this.camera.position.set(
      this.target.x + x,
      this.target.y + y,
      this.target.z + z,
    );

    this.camera.lookAt(
      new THREE.Vector3(this.target.x, this.target.y, this.target.z),
    );
  }

  private onMouseDown(event: MouseEvent): void {
    // Right-click or shift+click for pan
    if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
      this.isPanning = true;
    } else if (event.button === 0) {
      this.isRotating = true;
    }
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  private onMouseMove(event: MouseEvent): void {
    const deltaX = event.clientX - this.lastMouseX;
    const deltaY = event.clientY - this.lastMouseY;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;

    if (this.isRotating) {
      this.spherical.theta -= deltaX * this.rotateSpeed;
      this.spherical.phi -= deltaY * this.rotateSpeed;
      this.updateCameraPosition();
    } else if (this.isPanning) {
      if (!this.camera) return;

      // Pan in the camera's local plane
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      this.camera.getWorldDirection(new THREE.Vector3());
      right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      up.setFromMatrixColumn(this.camera.matrixWorld, 1);

      const panX = -deltaX * this.panSpeed * this.spherical.radius * 0.001;
      const panY = deltaY * this.panSpeed * this.spherical.radius * 0.001;

      this.target.x += right.x * panX + up.x * panY;
      this.target.y += right.y * panX + up.y * panY;
      this.target.z += right.z * panX + up.z * panY;

      this.updateCameraPosition();
    }
  }

  private onMouseUp(_event: MouseEvent): void {
    this.isRotating = false;
    this.isPanning = false;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 + this.zoomSpeed : 1 - this.zoomSpeed;
    this.spherical.radius *= delta;
    this.updateCameraPosition();
  }

  private onContextMenu(event: Event): void {
    event.preventDefault();
  }
}

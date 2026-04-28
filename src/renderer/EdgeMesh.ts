import * as THREE from 'three';
import type { Vector3 } from '../types.js';

export class EdgeMesh {
  private source: Vector3 = { x: 0, y: 0, z: 0 };
  private target: Vector3 = { x: 0, y: 0, z: 0 };
  private color: string = '#8a92b2';
  private opacity: number = 0.55;
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineBasicMaterial | null = null;

  setPositions(source: Vector3, target: Vector3): void {
    this.source = { ...source };
    this.target = { ...target };
  }

  getSource(): Vector3 {
    return this.source;
  }

  getTarget(): Vector3 {
    return this.target;
  }

  setColor(color: string): void {
    this.color = color;
  }

  getColor(): string {
    return this.color;
  }

  createLineSegments(count: number): void {
    this.dispose();
    // Each segment has 2 vertices, each vertex has 3 components (x, y, z)
    const positions = new Float32Array(count * 2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.geometry.setDrawRange(0, count * 2);
    this.material = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: this.opacity,
    });
    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);
  }

  /** Override the edge colour. Must be called before `createLineSegments`. */
  setColorOverride(color: string): void {
    this.color = color;
  }

  /** Override the edge opacity. Must be called before `createLineSegments`. */
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  updateSegment(index: number, source: Vector3, target: Vector3): void {
    if (!this.geometry) return;

    const positionAttr = this.geometry.getAttribute('position');
    if (!positionAttr) return;

    const array = positionAttr.array as Float32Array;
    const offset = index * 6; // 2 vertices * 3 components

    array[offset] = source.x;
    array[offset + 1] = source.y;
    array[offset + 2] = source.z;
    array[offset + 3] = target.x;
    array[offset + 4] = target.y;
    array[offset + 5] = target.z;

    positionAttr.needsUpdate = true;
  }

  getMesh(): THREE.LineSegments | null {
    return this.lineSegments;
  }

  dispose(): void {
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.lineSegments = null;
  }
}

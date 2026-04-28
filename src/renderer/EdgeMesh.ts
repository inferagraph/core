import * as THREE from 'three';
import type { Vector3 } from '../types.js';

/**
 * Per-edge line geometry. Internally a single `THREE.LineSegments` whose
 * vertex-color attribute carries one colour pair per edge — this keeps the
 * draw count at 1 while still letting the consumer paint each edge with its
 * own resolved colour (e.g. `father_of` cyan, `married_to` blue).
 *
 * Lifecycle:
 *   const mesh = new EdgeMesh();
 *   mesh.createLineSegments(edgeCount);
 *   edges.forEach((e, i) => {
 *     mesh.setSegmentColor(i, edgeColorMap.resolve(e));
 *     mesh.updateSegment(i, srcPos, tgtPos);
 *   });
 */
export class EdgeMesh {
  private source: Vector3 = { x: 0, y: 0, z: 0 };
  private target: Vector3 = { x: 0, y: 0, z: 0 };
  /** Default tint used for any segment that hasn't been given an explicit colour. */
  private color: string = '#8a92b2';
  private opacity: number = 0.55;
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineBasicMaterial | null = null;
  private segmentCount: number = 0;
  private readonly _scratch = new THREE.Color();

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
    this.segmentCount = count;
    // Each segment has 2 vertices, each vertex has 3 components (x, y, z)
    const positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 3);
    // Pre-fill the colour buffer with the default colour so newly-created
    // segments are visible even before the consumer assigns per-edge colours.
    this._scratch.set(this.color);
    for (let i = 0; i < count * 2; i++) {
      colors[i * 3 + 0] = this._scratch.r;
      colors[i * 3 + 1] = this._scratch.g;
      colors[i * 3 + 2] = this._scratch.b;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 3),
    );
    this.geometry.setDrawRange(0, count * 2);
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
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

  /**
   * Set the colour of a single segment by writing to both endpoint vertices
   * in the `color` buffer attribute. No-op if `createLineSegments` hasn't
   * run yet, or if `index` is out of range.
   */
  setSegmentColor(index: number, color: string): void {
    if (!this.geometry) return;
    if (index < 0 || index >= this.segmentCount) return;

    const colorAttr = this.geometry.getAttribute('color');
    if (!colorAttr) return;

    const array = colorAttr.array as Float32Array;
    const offset = index * 6; // 2 vertices * 3 components

    this._scratch.set(color);
    // Both endpoint vertices share the same colour so the line is uniform.
    array[offset + 0] = this._scratch.r;
    array[offset + 1] = this._scratch.g;
    array[offset + 2] = this._scratch.b;
    array[offset + 3] = this._scratch.r;
    array[offset + 4] = this._scratch.g;
    array[offset + 5] = this._scratch.b;

    colorAttr.needsUpdate = true;
  }

  /** Number of segments allocated by the most recent `createLineSegments`. */
  getSegmentCount(): number {
    return this.segmentCount;
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
    this.segmentCount = 0;
  }
}

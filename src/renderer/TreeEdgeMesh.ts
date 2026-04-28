import * as THREE from 'three';
import type { Vector3 } from '../types.js';

/**
 * Single straight line segment fed to {@link TreeEdgeMesh.build}. Each
 * segment carries its own colour so different connector kinds (marriage
 * line, sibling bar, parent-to-child drop) can be tinted independently.
 */
export interface TreeEdgeSegment {
  a: Vector3;
  b: Vector3;
  color: string;
}

/**
 * WebGL line geometry tuned for the tree-view's orthogonal connectors.
 *
 * Unlike {@link EdgeMesh} (which renders ONE segment per logical edge in
 * graph mode), this mesh accepts an arbitrary list of straight line
 * segments. The SceneController builds the list from the tree topology:
 *   - one segment per marriage (horizontal bar between paired spouses)
 *   - one vertical drop from each parent (or couple-midpoint) to a
 *     sibling-bar y
 *   - one horizontal sibling bar above each set of siblings
 *   - one vertical drop from the bar to each child's top edge
 *
 * The mesh holds a single `THREE.LineSegments` so the GPU draws every
 * segment in one call. Per-segment colours go through the vertex-colour
 * attribute, identical to the EdgeMesh implementation.
 */
export class TreeEdgeMesh {
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineBasicMaterial | null = null;
  private segmentCount = 0;
  /**
   * Connector opacity. The SVG mockup uses 0.3-0.4 — we land at 0.35 so
   * connectors recede from the cards without disappearing on dark themes.
   */
  private opacity = 0.35;

  /**
   * (Re)build the line geometry from `segments`. Replaces any previous
   * mesh — caller is responsible for removing the previous instance from
   * the scene before calling `build` again.
   */
  build(segments: TreeEdgeSegment[]): void {
    this.dispose();
    this.segmentCount = segments.length;

    const positions = new Float32Array(segments.length * 2 * 3);
    const colors = new Float32Array(segments.length * 2 * 3);
    const scratch = new THREE.Color();

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const offset = i * 6;
      positions[offset + 0] = s.a.x;
      positions[offset + 1] = s.a.y;
      positions[offset + 2] = s.a.z;
      positions[offset + 3] = s.b.x;
      positions[offset + 4] = s.b.y;
      positions[offset + 5] = s.b.z;

      scratch.set(s.color);
      colors[offset + 0] = scratch.r;
      colors[offset + 1] = scratch.g;
      colors[offset + 2] = scratch.b;
      colors[offset + 3] = scratch.r;
      colors[offset + 4] = scratch.g;
      colors[offset + 5] = scratch.b;
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
    this.geometry.setDrawRange(0, segments.length * 2);

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
    });
    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);
  }

  /** Override the connector opacity. Must be called before `build`. */
  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

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

import * as THREE from 'three';
import type { Vector3 } from '../types.js';
import type { VisibilityHost } from './types.js';

/**
 * @implements {VisibilityHost}
 *
 * Per-edge line geometry. Internally a single `THREE.LineSegments` whose
 * vertex-color attribute carries one colour-and-alpha quad per vertex —
 * this keeps the draw count at 1 while still letting the consumer paint
 * each edge with its own resolved colour (e.g. `father_of` cyan,
 * `married_to` blue) AND hide individual edges via {@link setVisibility}
 * by writing alpha=0 to both endpoints.
 *
 * Lifecycle:
 *   const mesh = new EdgeMesh();
 *   mesh.createLineSegments(edgeCount);
 *   edges.forEach((e, i) => {
 *     mesh.setSegmentColor(i, edgeColorMap.resolve(e));
 *     mesh.updateSegment(i, srcPos, tgtPos);
 *   });
 *   // ...later, on filter change:
 *   mesh.setVisibility(visibleEdgeIds);
 */
export class EdgeMesh implements VisibilityHost {
  private source: Vector3 = { x: 0, y: 0, z: 0 };
  private target: Vector3 = { x: 0, y: 0, z: 0 };
  /** Default tint used for any segment that hasn't been given an explicit colour. */
  private color: string = '#8a92b2';
  private opacity: number = 0.55;
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineBasicMaterial | null = null;
  private segmentCount: number = 0;
  /** Index → edge-id mapping. Populated by SceneController via {@link setEdgeIds}. */
  private edgeIds: string[] = [];
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
    // Each segment has 2 vertices, each vertex has 3 position components
    // (x, y, z) and 4 colour components (r, g, b, a). The alpha channel
    // is the visibility hook used by `setVisibility` — alpha=0 hides the
    // edge entirely, alpha=1 leaves it visible (modulated by the
    // material's base opacity).
    const positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 4);
    // Pre-fill the colour buffer with the default colour + alpha=1 so
    // newly-created segments are visible even before the consumer
    // assigns per-edge colours.
    this._scratch.set(this.color);
    for (let i = 0; i < count * 2; i++) {
      colors[i * 4 + 0] = this._scratch.r;
      colors[i * 4 + 1] = this._scratch.g;
      colors[i * 4 + 2] = this._scratch.b;
      colors[i * 4 + 3] = 1;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    this.geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colors, 4),
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
   * in the `color` buffer attribute. Preserves the alpha channel — to
   * hide a segment, use {@link setVisibility} (or the lower-level
   * {@link setSegmentAlpha}). No-op if `createLineSegments` hasn't run
   * yet, or if `index` is out of range.
   */
  setSegmentColor(index: number, color: string): void {
    if (!this.geometry) return;
    if (index < 0 || index >= this.segmentCount) return;

    const colorAttr = this.geometry.getAttribute('color');
    if (!colorAttr) return;

    const array = colorAttr.array as Float32Array;
    const offset = index * 8; // 2 vertices * 4 components (rgba)

    this._scratch.set(color);
    // Both endpoint vertices share the same colour so the line is
    // uniform. Alpha is left untouched so a previously-hidden segment
    // stays hidden when its colour is repainted.
    array[offset + 0] = this._scratch.r;
    array[offset + 1] = this._scratch.g;
    array[offset + 2] = this._scratch.b;
    array[offset + 4] = this._scratch.r;
    array[offset + 5] = this._scratch.g;
    array[offset + 6] = this._scratch.b;

    colorAttr.needsUpdate = true;
  }

  /**
   * Set the alpha of a single segment by writing to both endpoint
   * vertices in the `color` buffer attribute. No-op if
   * `createLineSegments` hasn't run yet, or if `index` is out of range.
   *
   * Used by {@link setVisibility} but also exposed for advanced
   * consumers that want per-segment fade effects.
   */
  setSegmentAlpha(index: number, alpha: number): void {
    if (!this.geometry) return;
    if (index < 0 || index >= this.segmentCount) return;

    const colorAttr = this.geometry.getAttribute('color');
    if (!colorAttr) return;

    const array = colorAttr.array as Float32Array;
    const offset = index * 8; // 2 vertices * 4 components (rgba)
    array[offset + 3] = alpha;
    array[offset + 7] = alpha;
    colorAttr.needsUpdate = true;
  }

  /**
   * Register the index → edge-id mapping so {@link setVisibility} can
   * resolve segment indices from the predicate's id set. The
   * SceneController owns the canonical mapping; the mesh just keeps a
   * reference.
   */
  setEdgeIds(ids: readonly string[]): void {
    this.edgeIds = ids.slice();
  }

  /**
   * Toggle per-edge visibility WITHOUT rebuild. For each segment index,
   * if the corresponding edge id is in `visibleIds` we set alpha to 1.0;
   * otherwise 0.0. The vertex-colour shader path multiplies the
   * fragment colour by the per-vertex alpha, so alpha=0 segments
   * disappear completely.
   *
   * No-op if the mesh hasn't been built yet, or if the edge id mapping
   * hasn't been registered via {@link setEdgeIds}.
   */
  setVisibility(visibleIds: ReadonlySet<string>): void {
    if (!this.geometry) return;
    if (this.edgeIds.length === 0) return;
    const n = Math.min(this.segmentCount, this.edgeIds.length);
    for (let i = 0; i < n; i++) {
      this.setSegmentAlpha(i, visibleIds.has(this.edgeIds[i]) ? 1 : 0);
    }
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
    this.edgeIds = [];
  }
}

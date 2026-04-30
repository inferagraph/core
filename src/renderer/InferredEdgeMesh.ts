import * as THREE from 'three';
import type { NodeId, Vector3 } from '../types.js';
import type { InferredEdge } from '../ai/InferredEdge.js';

/**
 * Visual constants for the inferred-edge overlay. Locked by the Phase 5
 * design round (see plan):
 *
 *   - {@link DASH_SIZE} / {@link GAP_SIZE} — dash + gap in world units.
 *   - {@link INFERRED_ALPHA} — sits between explicit baseline (0.55) and
 *     dimmed-non-highlight (0.15). Dim enough that inferred edges don't
 *     compete with the explicit graph; bright enough that they read as
 *     real signal when the user toggles the overlay on.
 *   - {@link INFERRED_COLOR} — same as the default {@link EdgeMesh.color}
 *     so inferred edges visually belong to the same family. v1 has no
 *     `inferredEdgeColor` prop; if/when we add one it goes through
 *     {@link InferredEdgeMesh.setColor}.
 */
const DASH_SIZE = 6;
const GAP_SIZE = 4;
const INFERRED_ALPHA = 0.3;
const INFERRED_COLOR = '#8a92b2';

/**
 * Renders the inferred-relationship overlay as a single `THREE.LineSegments`
 * with built-in dashed material. Each inferred edge contributes one
 * segment (two vertices) to the underlying buffer, mirroring the layout
 * used by {@link EdgeMesh}.
 *
 * Renderer-path resolution (see Phase 5 plan):
 *   - Plan recommended: separate mesh using `THREE.LineSegments` +
 *     `onBeforeCompile` shader-patched `LineBasicMaterial` for screen-
 *     space dashing.
 *   - Plan fallback: N independent `THREE.Line` objects, each with
 *     `LineDashedMaterial` + `computeLineDistances()`.
 *
 * This implementation takes the **single-mesh middle path**: one
 * `LineSegments` with `THREE.LineDashedMaterial` and a shared
 * `computeLineDistances()` call. The built-in `LineDashedMaterial`
 * already provides world-space dashed rendering across discontinuous
 * segments without a shader patch, so we get:
 *
 *   - The single-draw-call efficiency of the recommended path.
 *   - The robustness of the fallback (no fragile shader-chunk
 *     replacement that could break on Three.js minor upgrades).
 *
 * The overall visual matches the plan's locked constants: dash 6, gap 4,
 * alpha 0.30, color #8a92b2. World-space dashing is acceptable here
 * because biblegraph's graph extents stay within a controlled radius
 * established by the layout engine; the dash pattern reads consistently
 * at the user-facing camera distances. If we ever need true screen-space
 * dashing (camera-distance-invariant), the shader-patch path can be
 * dropped in behind the same {@link InferredEdgeHost} contract without
 * touching {@link SceneController} or the React layer.
 *
 * Lifecycle:
 *
 *   const mesh = new InferredEdgeMesh();
 *   // ... inferences arrive ...
 *   mesh.setInferredEdges(edges, positions);
 *   mesh.setVisibility(true);  // overlay starts hidden by default
 *   // ...later, on filter change / re-layout:
 *   mesh.setInferredEdges(newEdges, newPositions);
 *   // teardown:
 *   mesh.dispose();
 */
export class InferredEdgeMesh {
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineDashedMaterial | null = null;
  /**
   * Number of segments currently allocated. Distinct from
   * `edges.length` of the most recent {@link setInferredEdges} call —
   * we pre-allocate to the next power-of-two-ish size to avoid
   * thrashing geometry on every recompute, but we never reuse a buffer
   * across builds in v1: each `setInferredEdges` call disposes and
   * rebuilds. (Pool-based reuse is a Phase 6 optimisation.)
   */
  private segmentCount = 0;
  /** Last edges seen — kept for introspection / debugging. */
  private lastEdges: ReadonlyArray<InferredEdge> = [];
  /**
   * Visibility flag. False (hidden) is the v1 default per plan.
   * Wired through `Object3D.visible` so the toggle is a single boolean
   * write — no buffer mutation, no rebuild.
   */
  private visible = false;

  /**
   * Build (or rebuild) the line geometry from `edges`. Replaces any
   * previously-allocated geometry/material. Edges whose endpoints are
   * missing from `positions` are dropped silently.
   *
   * Call shape mirrors {@link EdgeMesh.createLineSegments} +
   * `updateSegment` collapsed into a single entry point — inferred
   * edges arrive in batches from the AI pipeline and there's no
   * incremental-update use case in v1.
   *
   * No-op when `edges` is empty after dropping edges with missing
   * endpoints (we still dispose the prior mesh so a hide-then-show
   * cycle starts clean).
   */
  setInferredEdges(
    edges: ReadonlyArray<InferredEdge>,
    positions: ReadonlyMap<NodeId, Vector3>,
  ): void {
    // Drop edges whose endpoints aren't in the position map. The
    // merger already filters explicit edges (so duplicates won't reach
    // us), but a stale inferred-edge set may reference nodes that
    // have since been removed from the graph.
    const valid: InferredEdge[] = [];
    for (const edge of edges) {
      if (positions.has(edge.sourceId) && positions.has(edge.targetId)) {
        valid.push(edge);
      }
    }
    this.lastEdges = valid;

    // Always tear down first — v1 takes the simple replace-on-set
    // path. If `valid` is empty we leave the mesh torn down; the
    // caller can re-show by passing a non-empty set later.
    this.dispose();

    if (valid.length === 0) return;

    this.segmentCount = valid.length;

    // Each segment has 2 vertices, 3 floats each.
    const positionArr = new Float32Array(valid.length * 2 * 3);
    for (let i = 0; i < valid.length; i++) {
      const edge = valid[i];
      const src = positions.get(edge.sourceId)!;
      const tgt = positions.get(edge.targetId)!;
      const offset = i * 6;
      positionArr[offset + 0] = src.x;
      positionArr[offset + 1] = src.y;
      positionArr[offset + 2] = src.z;
      positionArr[offset + 3] = tgt.x;
      positionArr[offset + 4] = tgt.y;
      positionArr[offset + 5] = tgt.z;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positionArr, 3),
    );

    // LineDashedMaterial provides built-in dashed rendering. The dash
    // pattern is in world units, computed per-vertex via
    // `computeLineDistances` below. Transparency + the dimmed alpha
    // (`INFERRED_ALPHA = 0.30`) put the overlay between the explicit
    // baseline (0.55) and dimmed-non-highlight (0.15) — visible
    // signal, but clearly subordinate to the explicit graph.
    this.material = new THREE.LineDashedMaterial({
      color: INFERRED_COLOR,
      dashSize: DASH_SIZE,
      gapSize: GAP_SIZE,
      transparent: true,
      opacity: INFERRED_ALPHA,
      // Inferred edges are an overlay; they should not punch holes in
      // the depth buffer. depthWrite=false matches NodeMesh's
      // visibility-aware materials.
      depthWrite: false,
    });

    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);
    // `computeLineDistances` walks `LineSegments` pair-by-pair (each
    // 2-vertex pair is treated as an independent line), populating a
    // `lineDistance` attribute used by `LineDashedMaterial`'s
    // fragment shader. Without this call the dashed material renders
    // as a solid line.
    if (typeof this.lineSegments.computeLineDistances === 'function') {
      this.lineSegments.computeLineDistances();
    }
    this.lineSegments.visible = this.visible;
  }

  /**
   * Toggle overlay visibility WITHOUT teardown. Defaults to `false`
   * (hidden) per the Phase 5 plan; hosts opt in via the
   * `showInferredEdges` prop on `<InferaGraph>` or via the
   * `set_inferred_visibility` chat tool call.
   */
  setVisibility(visible: boolean): void {
    this.visible = visible;
    if (this.lineSegments) {
      this.lineSegments.visible = visible;
    }
  }

  /** Visibility flag, for tests + introspection. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Number of segments currently allocated. Zero when torn down. */
  getSegmentCount(): number {
    return this.segmentCount;
  }

  /**
   * The Three.js mesh, or `null` when no edges have been pushed yet.
   * Hosts add this to the scene via {@link WebGLRenderer.addObject}.
   */
  getMesh(): THREE.LineSegments | null {
    return this.lineSegments;
  }

  /**
   * The active material, exposed for tests + introspection. Returns
   * `null` when no edges have been pushed yet.
   */
  getMaterial(): THREE.LineDashedMaterial | null {
    return this.material;
  }

  /**
   * Snapshot of the most recently pushed inferred edges (after dropping
   * any whose endpoints were unknown to the layout). Useful for tests
   * and for inspecting "what's on screen" via DevTools.
   */
  getEdges(): ReadonlyArray<InferredEdge> {
    return this.lastEdges;
  }

  /**
   * Free GPU resources. Idempotent. The visibility flag is preserved
   * across dispose/rebuild — re-creating the mesh after a dispose
   * starts hidden iff the most recent {@link setVisibility} was false,
   * which is what the host expects when it has never toggled the
   * overlay on.
   */
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

/**
 * Visual constants exported for tests / consumers that need to assert
 * on the locked design choices.
 */
export const INFERRED_EDGE_DASH_SIZE = DASH_SIZE;
export const INFERRED_EDGE_GAP_SIZE = GAP_SIZE;
export const INFERRED_EDGE_ALPHA = INFERRED_ALPHA;
export const INFERRED_EDGE_COLOR = INFERRED_COLOR;

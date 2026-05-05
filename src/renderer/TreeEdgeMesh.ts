import * as THREE from 'three';
import type { Vector3 } from '../types.js';
import type { HighlightHost, VisibilityHost } from './types.js';

/** Alpha applied to non-highlighted tree connectors. */
const TREE_EDGE_DIM_ALPHA = 0.15;

/**
 * Single straight line segment fed to {@link TreeEdgeMesh.build}. Each
 * segment carries its own color so different connector kinds (marriage
 * line, sibling bar, parent-to-child drop) can be tinted independently.
 *
 * Optional `sourceNodeId` / `targetNodeId` annotate which graph nodes
 * the segment connects so {@link TreeEdgeMesh.setVisibility} can hide
 * connectors whose endpoint nodes are filtered out. Connectors that
 * don't correspond to a single pair of nodes (e.g. a sibling-bar that
 * spans multiple children) typically pass the parent + the bar's
 * "anchor" child here; if either endpoint is hidden the bar disappears,
 * which is the correct behavior for the standard family-tree view.
 */
export interface TreeEdgeSegment {
  a: Vector3;
  b: Vector3;
  color: string;
  sourceNodeId?: string;
  targetNodeId?: string;
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
 * segment in one call. Per-segment colors go through the vertex-color
 * attribute, identical to the EdgeMesh implementation.
 */
/**
 * Pure (no THREE.js, no DOM) function that turns a node-position map plus
 * a typed edge list into the orthogonal-connector line-segments expected
 * by {@link TreeEdgeMesh.build}. Output composition (per parent / couple):
 *
 *   - 1 horizontal marriage line per couple, drawn at the parents' center-y.
 *   - 1 vertical drop from the parents down to a sibling-bar y, midway
 *     between the parents' bottom edge and the children's top edge.
 *     For a couple (≥2 parents at the same y) the drop starts at the
 *     parents' center-y so it meets the marriage line exactly. For a
 *     single parent it starts at the card's bottom edge.
 *   - 1 horizontal sibling bar across the children at the bar y.
 *   - 1 vertical drop from the bar to each child's top edge.
 *
 * Edges with a missing or unrecognized type are ignored — the tree view
 * cannot render arbitrary relations as hierarchy.
 */
export function buildTreeEdgeSegments(
  positions: Map<string, Vector3>,
  edges: Array<{ sourceId: string; targetId: string; type?: string }>,
  cardSize: { width: number; height: number },
): TreeEdgeSegment[] {
  const segments: TreeEdgeSegment[] = [];
  const halfH = cardSize.height / 2;
  const halfW = cardSize.width / 2;
  const connectorColor = '#a1a1aa';
  const marriageColor = '#a1a1aa';

  // Resolve type sets directly from the layout's source-of-truth.
  const PARENT = new Set(['father_of', 'mother_of', 'parent_of']);
  const SPOUSE = new Set(['husband_of', 'wife_of', 'married_to', 'spouse_of']);

  // Build groupings: child -> parent ids; node -> spouse ids.
  const parentsOfChild = new Map<string, Set<string>>();
  const spousesOf = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.type) continue;
    if (PARENT.has(e.type)) {
      const ps = parentsOfChild.get(e.targetId) ?? new Set<string>();
      ps.add(e.sourceId);
      parentsOfChild.set(e.targetId, ps);
    } else if (SPOUSE.has(e.type)) {
      const a = spousesOf.get(e.sourceId) ?? new Set<string>();
      a.add(e.targetId);
      spousesOf.set(e.sourceId, a);
      const b = spousesOf.get(e.targetId) ?? new Set<string>();
      b.add(e.sourceId);
      spousesOf.set(e.targetId, b);
    }
  }

  // ---- Marriage lines: emit one per pair (de-duplicated) ----
  const seenPair = new Set<string>();
  for (const [a, others] of spousesOf) {
    for (const b of others) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) continue;
      if (Math.abs(pa.y - pb.y) > 1) continue; // only horizontal pairs
      // Inner edges of the cards.
      const left = Math.min(pa.x, pb.x) + halfW;
      const right = Math.max(pa.x, pb.x) - halfW;
      segments.push({
        a: { x: left, y: pa.y, z: 0 },
        b: { x: right, y: pa.y, z: 0 },
        color: marriageColor,
        sourceNodeId: a,
        targetNodeId: b,
      });
    }
  }

  // ---- Parent → children: group children by their parent set ----
  // Two children sharing the same parents (i.e. siblings) get a single
  // sibling bar. We key by the sorted-unique parent-id tuple.
  const sibGroups = new Map<string, { parents: string[]; children: string[] }>();
  for (const [childId, parentIds] of parentsOfChild) {
    const parentsArr = Array.from(parentIds).sort();
    const key = parentsArr.join('|');
    const group = sibGroups.get(key) ?? { parents: parentsArr, children: [] };
    group.children.push(childId);
    sibGroups.set(key, group);
  }

  for (const { parents, children } of sibGroups.values()) {
    // Anchor x = midpoint of the parents that we have positions for.
    const presentParents = parents.filter((id) => positions.has(id));
    const parentPositions = presentParents
      .map((id) => positions.get(id)!)
      .filter((p): p is Vector3 => !!p);
    if (parentPositions.length === 0) continue;
    const presentChildren = children.filter((id) => positions.has(id));
    const childPositions = presentChildren
      .map((id) => positions.get(id)!)
      .filter((p): p is Vector3 => !!p);
    if (childPositions.length === 0) continue;

    const parentX =
      parentPositions.reduce((s, p) => s + p.x, 0) / parentPositions.length;
    const parentMinY = Math.min(...parentPositions.map((p) => p.y));
    const parentBottomY = parentMinY - halfH;
    const childTopY = Math.max(...childPositions.map((p) => p.y)) + halfH;
    // Sibling bar y: midway between parents' bottom and children's top.
    const barY = (parentBottomY + childTopY) / 2;

    // Anchor ids for visibility resolution. The "parent drop" + sibling
    // bar are tied to the first parent + first child — if either is
    // hidden by the filter, those connectors disappear too. Per-child
    // drops carry that specific child's id.
    const anchorParentId = presentParents[0];

    // 1) Vertical from the parents down to the sibling bar.
    //    For a couple (≥2 parents at the same y) the marriage line is
    //    drawn at the parents' center-y, so the drop must start there
    //    too — otherwise there's a `halfH` gap between the marriage line
    //    and the top of the drop. For a single parent there is no
    //    marriage line, so the drop starts at the card's bottom edge.
    const dropTopY = parentPositions.length >= 2 ? parentMinY : parentBottomY;
    segments.push({
      a: { x: parentX, y: dropTopY, z: 0 },
      b: { x: parentX, y: barY, z: 0 },
      color: connectorColor,
      sourceNodeId: anchorParentId,
      targetNodeId: presentChildren[0],
    });

    // 2) Horizontal sibling bar across all children.
    const minX = Math.min(parentX, ...childPositions.map((p) => p.x));
    const maxX = Math.max(parentX, ...childPositions.map((p) => p.x));
    if (Math.abs(maxX - minX) > 0.5) {
      segments.push({
        a: { x: minX, y: barY, z: 0 },
        b: { x: maxX, y: barY, z: 0 },
        color: connectorColor,
        sourceNodeId: anchorParentId,
        targetNodeId: presentChildren[0],
      });
    }

    // 3) Drop from bar to each child's top edge.
    for (let ci = 0; ci < presentChildren.length; ci++) {
      const cp = childPositions[ci];
      segments.push({
        a: { x: cp.x, y: barY, z: 0 },
        b: { x: cp.x, y: cp.y + halfH, z: 0 },
        color: connectorColor,
        sourceNodeId: anchorParentId,
        targetNodeId: presentChildren[ci],
      });
    }
  }

  return segments;
}

/**
 * @implements {VisibilityHost}
 * @implements {HighlightHost}
 */
export class TreeEdgeMesh implements VisibilityHost, HighlightHost {
  private lineSegments: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.LineBasicMaterial | null = null;
  private segmentCount = 0;
  /**
   * Per-segment endpoint node ids. Built alongside the mesh by
   * {@link build} from each {@link TreeEdgeSegment}'s
   * `sourceNodeId` / `targetNodeId`. Used by {@link setVisibility} to
   * decide which segments to hide.
   */
  private segmentEndpoints: Array<{
    sourceNodeId?: string;
    targetNodeId?: string;
  }> = [];
  /**
   * Connector opacity. The SVG mockup uses 0.3-0.4 — we land at 0.35 so
   * connectors recede from the cards without disappearing on dark themes.
   */
  private opacity = 0.35;
  /** Last visibility set seen; null = "no visibility filter applied yet". */
  private visibleIds: ReadonlySet<string> | null = null;
  /** Last highlight set seen. Empty = baseline. */
  private highlightIds: ReadonlySet<string> = new Set();

  /**
   * (Re)build the line geometry from `segments`. Replaces any previous
   * mesh — caller is responsible for removing the previous instance from
   * the scene before calling `build` again.
   *
   * Color buffer layout is RGBA (4 components per vertex, 2 vertices
   * per segment) so {@link setVisibility} can drive alpha to 0 to hide
   * connectors without rebuilding the mesh.
   */
  build(segments: TreeEdgeSegment[]): void {
    this.dispose();
    this.segmentCount = segments.length;

    const positions = new Float32Array(segments.length * 2 * 3);
    const colors = new Float32Array(segments.length * 2 * 4);
    const scratch = new THREE.Color();

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const posOffset = i * 6;
      positions[posOffset + 0] = s.a.x;
      positions[posOffset + 1] = s.a.y;
      positions[posOffset + 2] = s.a.z;
      positions[posOffset + 3] = s.b.x;
      positions[posOffset + 4] = s.b.y;
      positions[posOffset + 5] = s.b.z;

      const colOffset = i * 8;
      scratch.set(s.color);
      colors[colOffset + 0] = scratch.r;
      colors[colOffset + 1] = scratch.g;
      colors[colOffset + 2] = scratch.b;
      colors[colOffset + 3] = 1;
      colors[colOffset + 4] = scratch.r;
      colors[colOffset + 5] = scratch.g;
      colors[colOffset + 6] = scratch.b;
      colors[colOffset + 7] = 1;
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
    this.geometry.setDrawRange(0, segments.length * 2);

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
    });
    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);

    // Stash the endpoint mapping so `setVisibility` can resolve which
    // segments to hide. Segments without endpoint ids (e.g. a custom
    // overlay segment built outside the standard pipeline) are kept
    // visible regardless of the predicate.
    this.segmentEndpoints = segments.map((s) => ({
      sourceNodeId: s.sourceNodeId,
      targetNodeId: s.targetNodeId,
    }));
  }

  /**
   * Toggle per-segment visibility WITHOUT rebuild. Tree edges are
   * derived from node visibility — a connector's source-node OR
   * target-node being hidden hides the connector — so this method
   * accepts a set of NODE ids (not segment ids) for symmetry with the
   * other `VisibilityHost` implementations.
   *
   * Segments whose endpoints were not annotated (the optional
   * `sourceNodeId` / `targetNodeId` on {@link TreeEdgeSegment}) are
   * always visible — the host opted out of the visibility predicate
   * for them.
   *
   * No-op if the mesh hasn't been built yet.
   */
  setVisibility(visibleNodeIds: ReadonlySet<string>): void {
    this.visibleIds = visibleNodeIds;
    this.recomputeAlpha();
  }

  /**
   * Highlight tree connectors. A connector keeps full alpha when BOTH of
   * its endpoint nodes are in `highlightIds`; otherwise it dims to
   * {@link TREE_EDGE_DIM_ALPHA}. Empty set = baseline. Visibility wins.
   */
  setHighlight(highlightIds: ReadonlySet<string>): void {
    this.highlightIds = highlightIds;
    this.recomputeAlpha();
  }

  private recomputeAlpha(): void {
    if (!this.geometry) return;
    if (this.segmentCount === 0) return;
    const colorAttr = this.geometry.getAttribute('color');
    if (!colorAttr) return;
    const array = colorAttr.array as Float32Array;
    const hasVisibility = this.visibleIds !== null;
    const visible = this.visibleIds;
    const hasHighlight = this.highlightIds.size > 0;
    for (let i = 0; i < this.segmentCount; i++) {
      const ep = this.segmentEndpoints[i];
      let alpha = 1;
      if (ep && (ep.sourceNodeId !== undefined || ep.targetNodeId !== undefined)) {
        if (hasVisibility) {
          const sourceVisible =
            ep.sourceNodeId === undefined || visible!.has(ep.sourceNodeId);
          const targetVisible =
            ep.targetNodeId === undefined || visible!.has(ep.targetNodeId);
          if (!(sourceVisible && targetVisible)) alpha = 0;
        }
        if (alpha > 0 && hasHighlight) {
          const sourceHi =
            ep.sourceNodeId === undefined ||
            this.highlightIds.has(ep.sourceNodeId);
          const targetHi =
            ep.targetNodeId === undefined ||
            this.highlightIds.has(ep.targetNodeId);
          if (!(sourceHi && targetHi)) alpha = TREE_EDGE_DIM_ALPHA;
        }
      }
      const offset = i * 8;
      array[offset + 3] = alpha;
      array[offset + 7] = alpha;
    }
    colorAttr.needsUpdate = true;
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
    this.segmentEndpoints = [];
    this.visibleIds = null;
    this.highlightIds = new Set();
  }
}

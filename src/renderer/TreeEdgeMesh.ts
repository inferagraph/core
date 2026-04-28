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
/**
 * Pure (no THREE.js, no DOM) function that turns a node-position map plus
 * a typed edge list into the orthogonal-connector line-segments expected
 * by {@link TreeEdgeMesh.build}. Output composition (per parent / couple):
 *
 *   - 1 horizontal marriage line per couple, drawn at the parents' centre-y.
 *   - 1 vertical drop from the parents down to a sibling-bar y, midway
 *     between the parents' bottom edge and the children's top edge.
 *     For a couple (≥2 parents at the same y) the drop starts at the
 *     parents' centre-y so it meets the marriage line exactly. For a
 *     single parent it starts at the card's bottom edge.
 *   - 1 horizontal sibling bar across the children at the bar y.
 *   - 1 vertical drop from the bar to each child's top edge.
 *
 * Edges with a missing or unrecognised type are ignored — the tree view
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
    const parentPositions = parents
      .map((id) => positions.get(id))
      .filter((p): p is Vector3 => !!p);
    if (parentPositions.length === 0) continue;
    const childPositions = children
      .map((id) => positions.get(id))
      .filter((p): p is Vector3 => !!p);
    if (childPositions.length === 0) continue;

    const parentX =
      parentPositions.reduce((s, p) => s + p.x, 0) / parentPositions.length;
    const parentMinY = Math.min(...parentPositions.map((p) => p.y));
    const parentBottomY = parentMinY - halfH;
    const childTopY = Math.max(...childPositions.map((p) => p.y)) + halfH;
    // Sibling bar y: midway between parents' bottom and children's top.
    const barY = (parentBottomY + childTopY) / 2;

    // 1) Vertical from the parents down to the sibling bar.
    //    For a couple (≥2 parents at the same y) the marriage line is
    //    drawn at the parents' centre-y, so the drop must start there
    //    too — otherwise there's a `halfH` gap between the marriage line
    //    and the top of the drop. For a single parent there is no
    //    marriage line, so the drop starts at the card's bottom edge.
    const dropTopY = parentPositions.length >= 2 ? parentMinY : parentBottomY;
    segments.push({
      a: { x: parentX, y: dropTopY, z: 0 },
      b: { x: parentX, y: barY, z: 0 },
      color: connectorColor,
    });

    // 2) Horizontal sibling bar across all children.
    const minX = Math.min(parentX, ...childPositions.map((p) => p.x));
    const maxX = Math.max(parentX, ...childPositions.map((p) => p.x));
    if (Math.abs(maxX - minX) > 0.5) {
      segments.push({
        a: { x: minX, y: barY, z: 0 },
        b: { x: maxX, y: barY, z: 0 },
        color: connectorColor,
      });
    }

    // 3) Drop from bar to each child's top edge.
    for (const cp of childPositions) {
      segments.push({
        a: { x: cp.x, y: barY, z: 0 },
        b: { x: cp.x, y: cp.y + halfH, z: 0 },
        color: connectorColor,
      });
    }
  }

  return segments;
}

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

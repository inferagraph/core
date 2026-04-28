import type { NodeId, Vector3, LayoutOptions } from '../types.js';
import { LayoutEngine, type LayoutEdgeInput } from './LayoutEngine.js';

/**
 * Hierarchical tidy-tree layout with spouse pairing. Drives the "tree" view
 * mode: family trees, taxonomies, anything where the user wants to see
 * lineage as parents-on-top, children-below cards.
 *
 * Inputs:
 *   - `nodeIds`: every node in the active store.
 *   - `edges`: each entry carries `{ sourceId, targetId, type? }`. The
 *     layout consults `type` to distinguish parent-child edges
 *     (`father_of`, `mother_of`, `parent_of`) from spouse edges
 *     (`husband_of`, `wife_of`, `married_to`). Edges with a missing or
 *     unrecognised type are ignored — this is intentional: a tree view
 *     can't render arbitrary relations as hierarchy without misleading the
 *     user.
 *
 * Output:
 *   - `Map<NodeId, Vector3>` with z=0 for every node (the tree view is
 *     planar).
 *
 * Algorithm — a simplified Reingold-Tilford with three twists for the
 * Bible Graph use case:
 *
 *   1. Spouse pairing happens BEFORE tree placement. Spouses are merged
 *      into "couple groups" that occupy two adjacent slots at the same
 *      depth and share children. This is what produces the
 *      "Abraham — Sarah" horizontal pair sitting on top of "Isaac".
 *
 *   2. Roots are nodes with no parents. If the data has a cycle (e.g.
 *      Bible Graph emits gender-specific reciprocal edges, which the
 *      visited-set guard absorbs) the tree is rooted at whichever node
 *      we encounter first that hasn't been visited. Disconnected
 *      sub-trees are laid out side-by-side, separated by a `FOREST_GAP`.
 *
 *   3. Cycle protection — a `visited` set guards every recursive call so
 *      bidirectional edges (`father_of` ↔ `son_of`, generation-skipping
 *      cycles, self-loops) cannot blow the call stack. This is the
 *      0.1.9 cycle-protection contract that the user has signed off on.
 */
export class TreeLayout extends LayoutEngine {
  readonly name = 'tree';

  /** Vertical distance between layers of the tree. */
  static readonly LEVEL_HEIGHT = 100;

  /**
   * Horizontal distance between two sibling card centres. Slightly wider
   * than the SVG mockup's `90` card width so cards don't touch.
   */
  static readonly NODE_SPACING_X = 110;

  /** Horizontal gap between two paired spouses (centre-to-centre). */
  static readonly SPOUSE_GAP_X = 110;

  /** Horizontal gap between disconnected sub-trees (forest layout). */
  static readonly FOREST_GAP = 60;

  /** Edge types treated as parent → child. */
  private static readonly PARENT_TYPES = new Set([
    'father_of',
    'mother_of',
    'parent_of',
  ]);

  /** Edge types treated as spouse pairings (symmetric). */
  private static readonly SPOUSE_TYPES = new Set([
    'husband_of',
    'wife_of',
    'married_to',
    'spouse_of',
  ]);

  private positions = new Map<NodeId, Vector3>();

  constructor(options?: LayoutOptions) {
    super({ animated: false, ...options });
  }

  compute(
    nodeIds: NodeId[],
    edges: Array<LayoutEdgeInput>,
  ): Map<NodeId, Vector3> {
    this.positions.clear();
    if (nodeIds.length === 0) return this.positions;

    // ---- Build adjacency from typed edges ----
    // childrenOf:  parentId   -> ordered list of childIds
    // parentsOf:   childId    -> Set of parentIds
    // spousesOf:   nodeId     -> Set of spouseIds
    //
    // Edges without a `type` are ignored — see class doc for why. Edges
    // whose type is neither a parent edge nor a spouse edge are also
    // ignored (e.g. `lived_in`, `home_of`).
    const childrenOf = new Map<NodeId, NodeId[]>();
    const parentsOf = new Map<NodeId, Set<NodeId>>();
    const spousesOf = new Map<NodeId, Set<NodeId>>();
    const nodeSet = new Set(nodeIds);

    for (const edge of edges) {
      if (!nodeSet.has(edge.sourceId) || !nodeSet.has(edge.targetId)) continue;
      const t = edge.type;
      if (!t) continue;

      if (TreeLayout.PARENT_TYPES.has(t)) {
        if (edge.sourceId === edge.targetId) continue; // self-parent is nonsense
        const list = childrenOf.get(edge.sourceId) ?? [];
        if (!list.includes(edge.targetId)) list.push(edge.targetId);
        childrenOf.set(edge.sourceId, list);
        const ps = parentsOf.get(edge.targetId) ?? new Set<NodeId>();
        ps.add(edge.sourceId);
        parentsOf.set(edge.targetId, ps);
      } else if (TreeLayout.SPOUSE_TYPES.has(t)) {
        if (edge.sourceId === edge.targetId) continue;
        const a = spousesOf.get(edge.sourceId) ?? new Set<NodeId>();
        a.add(edge.targetId);
        spousesOf.set(edge.sourceId, a);
        const b = spousesOf.get(edge.targetId) ?? new Set<NodeId>();
        b.add(edge.sourceId);
        spousesOf.set(edge.targetId, b);
      }
    }

    // ---- Find roots ----
    // A root is a node with no parents. If a node is part of a parent
    // cycle (everyone has a parent) we still need an entry point —
    // process unvisited nodes as additional roots after the main pass.
    const visited = new Set<NodeId>();
    const placedAsSpouseOf = new Map<NodeId, NodeId>(); // spouse -> primary id
    const roots: NodeId[] = [];
    for (const id of nodeIds) {
      const parents = parentsOf.get(id);
      if (!parents || parents.size === 0) roots.push(id);
    }

    // De-duplicate roots so we don't lay out the same couple twice: if
    // two spouses are both roots, the second one will be paired by the
    // primary's placement.
    let cursorX = 0;
    for (const root of roots) {
      if (visited.has(root) || placedAsSpouseOf.has(root)) continue;
      const subtreeWidth = this.layoutSubtree(
        root,
        0,
        cursorX,
        childrenOf,
        spousesOf,
        visited,
        placedAsSpouseOf,
      );
      cursorX += subtreeWidth + TreeLayout.FOREST_GAP;
    }

    // ---- Mop up disconnected nodes / cycle survivors ----
    // Anything still unvisited is part of a parent cycle (the visited-set
    // guard kicked in) or simply orphaned. Lay them out as additional
    // forest entries so they're visible rather than stacked on (0,0).
    for (const id of nodeIds) {
      if (visited.has(id) || placedAsSpouseOf.has(id)) continue;
      const subtreeWidth = this.layoutSubtree(
        id,
        0,
        cursorX,
        childrenOf,
        spousesOf,
        visited,
        placedAsSpouseOf,
      );
      cursorX += subtreeWidth + TreeLayout.FOREST_GAP;
    }

    // Recentre horizontally so the whole tree is symmetric around x=0.
    this.recentre();

    return this.positions;
  }

  tick(): void {
    // Tree layout is static.
  }

  getPositions(): Map<NodeId, Vector3> {
    return this.positions;
  }

  /**
   * Place `nodeId` (and its spouse, if any, and all of their children) at
   * `depth`, starting at horizontal `xOffset`. Returns the total width
   * consumed by this subtree so the caller can advance the cursor for the
   * next sibling/forest entry.
   */
  private layoutSubtree(
    nodeId: NodeId,
    depth: number,
    xOffset: number,
    childrenOf: Map<NodeId, NodeId[]>,
    spousesOf: Map<NodeId, Set<NodeId>>,
    visited: Set<NodeId>,
    placedAsSpouseOf: Map<NodeId, NodeId>,
  ): number {
    // Cycle guard: bidirectional edges (`father_of` ↔ `son_of`, marriage
    // chains, self-loops) and a defensive depth cap stop runaway recursion.
    if (visited.has(nodeId) || depth > 1000) {
      this.positions.set(nodeId, {
        x: xOffset,
        y: -depth * TreeLayout.LEVEL_HEIGHT,
        z: 0,
      });
      return TreeLayout.NODE_SPACING_X;
    }
    visited.add(nodeId);

    // Pick a single spouse (if any) to pair with at this level. Multiple
    // spouses get linearised as siblings of the primary at +1 slot each;
    // the typical Bible Graph case is monogamous, so we keep this simple.
    let spouse: NodeId | null = null;
    const candidates = spousesOf.get(nodeId);
    if (candidates) {
      for (const s of candidates) {
        if (!visited.has(s) && !placedAsSpouseOf.has(s)) {
          spouse = s;
          break;
        }
      }
    }
    if (spouse) {
      placedAsSpouseOf.set(spouse, nodeId);
      visited.add(spouse);
    }

    // Children come from BOTH partners — a couple's children are the
    // union of each partner's `children` list. Stable order: primary's
    // children first, then any spouse-only children appended.
    const ownChildren = (childrenOf.get(nodeId) ?? []).filter(
      (c) => !visited.has(c) && !placedAsSpouseOf.has(c),
    );
    const spouseChildren = spouse
      ? (childrenOf.get(spouse) ?? []).filter(
          (c) =>
            !visited.has(c) &&
            !placedAsSpouseOf.has(c) &&
            !ownChildren.includes(c),
        )
      : [];
    const childIds = [...ownChildren, ...spouseChildren];

    // ---- Leaf case (no children) ----
    if (childIds.length === 0) {
      const y = -depth * TreeLayout.LEVEL_HEIGHT;
      if (spouse) {
        this.positions.set(nodeId, { x: xOffset, y, z: 0 });
        this.positions.set(spouse, {
          x: xOffset + TreeLayout.SPOUSE_GAP_X,
          y,
          z: 0,
        });
        return TreeLayout.SPOUSE_GAP_X + TreeLayout.NODE_SPACING_X;
      }
      this.positions.set(nodeId, { x: xOffset, y, z: 0 });
      return TreeLayout.NODE_SPACING_X;
    }

    // ---- Internal node: lay out children first, then centre parents above ----
    let childCursor = xOffset;
    const childCentres: number[] = [];
    for (const childId of childIds) {
      const subtreeWidth = this.layoutSubtree(
        childId,
        depth + 1,
        childCursor,
        childrenOf,
        spousesOf,
        visited,
        placedAsSpouseOf,
      );
      // The child subtree may have been a couple — its rendered centre is
      // the midpoint of its first node and the previous cursor + width.
      const childPos = this.positions.get(childId);
      const childCentre = childPos
        ? childPos.x + (this.computeRenderedHalfWidth(childId, spousesOf) ?? 0)
        : childCursor;
      childCentres.push(childCentre);
      childCursor += subtreeWidth;
    }

    const childrenSpan = childCursor - xOffset;
    const childrenCentre =
      (childCentres[0] + childCentres[childCentres.length - 1]) / 2;

    const y = -depth * TreeLayout.LEVEL_HEIGHT;
    if (spouse) {
      // Couple spans `SPOUSE_GAP_X` and is centred over the children.
      const coupleCentre = childrenCentre;
      const left = coupleCentre - TreeLayout.SPOUSE_GAP_X / 2;
      const right = coupleCentre + TreeLayout.SPOUSE_GAP_X / 2;
      this.positions.set(nodeId, { x: left, y, z: 0 });
      this.positions.set(spouse, { x: right, y, z: 0 });
    } else {
      this.positions.set(nodeId, { x: childrenCentre, y, z: 0 });
    }

    return Math.max(childrenSpan, TreeLayout.NODE_SPACING_X);
  }

  /**
   * Half the rendered width of a node when it might be paired with a
   * spouse. Returns 0 for a solo node, `SPOUSE_GAP_X / 2` for a paired
   * node — this is used so {@link layoutSubtree} can compute the
   * children-centre relative to the paired couple's bounding box rather
   * than the primary node's centre alone.
   */
  private computeRenderedHalfWidth(
    nodeId: NodeId,
    spousesOf: Map<NodeId, Set<NodeId>>,
  ): number {
    const candidates = spousesOf.get(nodeId);
    if (!candidates) return 0;
    for (const s of candidates) {
      if (this.positions.has(s)) {
        const a = this.positions.get(nodeId)!;
        const b = this.positions.get(s)!;
        if (Math.abs(a.y - b.y) < 1) {
          // Paired at the same row — half-width is half the centre-to-centre gap.
          return Math.abs(b.x - a.x) / 2;
        }
      }
    }
    return 0;
  }

  /**
   * Translate the entire layout so the centre of mass sits at x=0. Tree
   * placement starts at x=0 and grows rightward; without recentring the
   * camera framing would have to compensate. We do it here so consumers
   * (and the SceneController's `frameToFit`) get a predictable origin.
   */
  private recentre(): void {
    if (this.positions.size === 0) return;
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const p of this.positions.values()) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
    }
    const dx = (xMin + xMax) / 2;
    if (Math.abs(dx) < 1e-6) return;
    for (const p of this.positions.values()) {
      p.x -= dx;
    }
  }
}

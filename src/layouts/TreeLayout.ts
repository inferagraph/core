import type { NodeId, Vector3, LayoutOptions } from '../types.js';
import { LayoutEngine, type LayoutEdgeInput } from './LayoutEngine.js';

/**
 * Hierarchical tidy-tree layout. Drives the "tree" view mode for any
 * domain in which the host wants to see a directed acyclic-ish graph as
 * parents-on-top, children-below cards: org charts (Director manages
 * Engineer), supply chains (Mill supplies Bakery), taxonomies (Mammal
 * is_a Animal), citation graphs (PaperA cites PaperB), family trees
 * (Parent parent_of Child), and so on.
 *
 * The layout is domain-agnostic. It does NOT recognise any particular
 * edge-type vocabulary; the host configures which edge types form
 * hierarchy via {@link TreeLayoutOptions.parentEdgeTypes} and (optionally)
 * which edge types pair two nodes at the same depth via
 * {@link TreeLayoutOptions.pairedEdgeTypes}.
 *
 * Inputs:
 *   - `nodeIds`: every node in the active store.
 *   - `edges`: each entry carries `{ sourceId, targetId, type? }`. The
 *     layout consults `type` to decide whether an edge represents a
 *     parent->child relation, a same-depth pair, or neither. Edges with
 *     a missing or unrecognised `type` are ignored — this is intentional:
 *     a tree view can't render arbitrary relations as hierarchy without
 *     misleading the reader.
 *
 * Output:
 *   - `Map<NodeId, Vector3>` with z=0 for every node (the tree view is
 *     planar).
 *
 * Algorithm — a simplified Reingold-Tilford with three twists:
 *
 *   1. Same-depth pairing happens BEFORE tree placement. Pair members
 *      are merged into "pair groups" that occupy two adjacent slots at
 *      the same depth and share children. (E.g. two co-leads in an org
 *      chart who share direct reports, or two paired entities at the
 *      top of a hierarchy.)
 *
 *   2. Roots are nodes with no parents. If the data has a cycle (the
 *      visited-set guard absorbs it) the tree is rooted at whichever
 *      node we encounter first that hasn't been visited. Disconnected
 *      sub-trees are laid out side-by-side, separated by a `FOREST_GAP`.
 *
 *   3. Cycle protection — a `visited` set guards every recursive call so
 *      bidirectional edges (X parent_of Y AND Y parent_of X) and
 *      self-loops cannot blow the call stack.
 */
export interface TreeLayoutOptions extends LayoutOptions {
  /**
   * Edge types treated as parent -> child for the hierarchical tidy-tree
   * layout. The layout interprets each edge of the listed types as
   * "source is the parent of target"; any other edge type is ignored
   * (a tree view can't faithfully render arbitrary relations as
   * hierarchy without misleading the reader).
   *
   * Default: `['parent_of']` — the conventional CS-tree term, generic
   * enough to cover org charts (rename your edges or pass
   * `['manages']`), supply chains (`['supplies']`), taxonomies
   * (`['is_a']` or `['subclass_of']`), citations (`['cites']`), and
   * family trees (`['father_of', 'mother_of', 'parent_of']`).
   */
  parentEdgeTypes?: string[];
  /**
   * Edge types that pair two nodes at the same depth so they appear
   * adjacent and share children. The mechanism is generic — co-leads in
   * an org chart, allied suppliers in a supply chain, paired spouses in
   * a family tree, etc. Empty by default (no pairing).
   *
   * Default: `[]`.
   */
  pairedEdgeTypes?: string[];
}

export class TreeLayout extends LayoutEngine {
  readonly name = 'tree';

  /** Vertical distance between layers of the tree. */
  static readonly LEVEL_HEIGHT = 100;

  /**
   * Horizontal distance between two sibling card centres. Slightly wider
   * than the SVG mockup's `90` card width so cards don't touch.
   */
  static readonly NODE_SPACING_X = 110;

  /** Horizontal gap between two paired peers (centre-to-centre). */
  static readonly PAIR_GAP_X = 110;

  /** Horizontal gap between disconnected sub-trees (forest layout). */
  static readonly FOREST_GAP = 60;

  /** Edge types treated as parent -> child. Configured per-instance. */
  private readonly parentTypes: ReadonlySet<string>;

  /** Edge types treated as same-depth pairs (symmetric). Configured per-instance. */
  private readonly pairedTypes: ReadonlySet<string>;

  private positions = new Map<NodeId, Vector3>();

  constructor(options?: TreeLayoutOptions) {
    super({ animated: false, ...options });
    this.parentTypes = new Set(options?.parentEdgeTypes ?? ['parent_of']);
    this.pairedTypes = new Set(options?.pairedEdgeTypes ?? []);
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
    // pairsOf:     nodeId     -> Set of paired peer ids
    //
    // Edges without a `type` are ignored — see class doc for why. Edges
    // whose type is neither a parent edge nor a pair edge are also
    // ignored (e.g. `lived_in`, `home_of`).
    const childrenOf = new Map<NodeId, NodeId[]>();
    const parentsOf = new Map<NodeId, Set<NodeId>>();
    const pairsOf = new Map<NodeId, Set<NodeId>>();
    const nodeSet = new Set(nodeIds);

    for (const edge of edges) {
      if (!nodeSet.has(edge.sourceId) || !nodeSet.has(edge.targetId)) continue;
      const t = edge.type;
      if (!t) continue;

      if (this.parentTypes.has(t)) {
        if (edge.sourceId === edge.targetId) continue; // self-parent is nonsense
        const list = childrenOf.get(edge.sourceId) ?? [];
        if (!list.includes(edge.targetId)) list.push(edge.targetId);
        childrenOf.set(edge.sourceId, list);
        const ps = parentsOf.get(edge.targetId) ?? new Set<NodeId>();
        ps.add(edge.sourceId);
        parentsOf.set(edge.targetId, ps);
      } else if (this.pairedTypes.has(t)) {
        if (edge.sourceId === edge.targetId) continue;
        const a = pairsOf.get(edge.sourceId) ?? new Set<NodeId>();
        a.add(edge.targetId);
        pairsOf.set(edge.sourceId, a);
        const b = pairsOf.get(edge.targetId) ?? new Set<NodeId>();
        b.add(edge.sourceId);
        pairsOf.set(edge.targetId, b);
      }
    }

    // ---- Find roots ----
    // A root is a node with no parents. If a node is part of a parent
    // cycle (everyone has a parent) we still need an entry point —
    // process unvisited nodes as additional roots after the main pass.
    const visited = new Set<NodeId>();
    const placedAsPeerOf = new Map<NodeId, NodeId>(); // peer -> primary id
    const roots: NodeId[] = [];
    for (const id of nodeIds) {
      const parents = parentsOf.get(id);
      if (!parents || parents.size === 0) roots.push(id);
    }

    // De-duplicate roots so we don't lay out the same pair twice: if
    // two paired peers are both roots, the second one will be paired by
    // the primary's placement.
    let cursorX = 0;
    for (const root of roots) {
      if (visited.has(root) || placedAsPeerOf.has(root)) continue;
      const subtreeWidth = this.layoutSubtree(
        root,
        0,
        cursorX,
        childrenOf,
        pairsOf,
        visited,
        placedAsPeerOf,
      );
      cursorX += subtreeWidth + TreeLayout.FOREST_GAP;
    }

    // ---- Mop up disconnected nodes / cycle survivors ----
    // Anything still unvisited is part of a parent cycle (the visited-set
    // guard kicked in) or simply orphaned. Lay them out as additional
    // forest entries so they're visible rather than stacked on (0,0).
    for (const id of nodeIds) {
      if (visited.has(id) || placedAsPeerOf.has(id)) continue;
      const subtreeWidth = this.layoutSubtree(
        id,
        0,
        cursorX,
        childrenOf,
        pairsOf,
        visited,
        placedAsPeerOf,
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
   * Place `nodeId` (and its paired peer, if any, and all of their
   * children) at `depth`, starting at horizontal `xOffset`. Returns the
   * total width consumed by this subtree so the caller can advance the
   * cursor for the next sibling/forest entry.
   */
  private layoutSubtree(
    nodeId: NodeId,
    depth: number,
    xOffset: number,
    childrenOf: Map<NodeId, NodeId[]>,
    pairsOf: Map<NodeId, Set<NodeId>>,
    visited: Set<NodeId>,
    placedAsPeerOf: Map<NodeId, NodeId>,
  ): number {
    // Cycle guard: bidirectional edges (X parent_of Y AND Y parent_of
    // X), pair chains, self-loops, and a defensive depth cap stop runaway
    // recursion.
    if (visited.has(nodeId) || depth > 1000) {
      this.positions.set(nodeId, {
        x: xOffset,
        y: -depth * TreeLayout.LEVEL_HEIGHT,
        z: 0,
      });
      return TreeLayout.NODE_SPACING_X;
    }
    visited.add(nodeId);

    // Pick a single peer (if any) to pair with at this level. Multiple
    // peers get linearised as siblings of the primary at +1 slot each;
    // the typical case is monogamous pairing (or none at all), so we
    // keep this simple.
    let peer: NodeId | null = null;
    const candidates = pairsOf.get(nodeId);
    if (candidates) {
      for (const s of candidates) {
        if (!visited.has(s) && !placedAsPeerOf.has(s)) {
          peer = s;
          break;
        }
      }
    }
    if (peer) {
      placedAsPeerOf.set(peer, nodeId);
      visited.add(peer);
    }

    // Children come from BOTH partners — a pair's children are the
    // union of each partner's `children` list. Stable order: primary's
    // children first, then any peer-only children appended.
    const ownChildren = (childrenOf.get(nodeId) ?? []).filter(
      (c) => !visited.has(c) && !placedAsPeerOf.has(c),
    );
    const peerChildren = peer
      ? (childrenOf.get(peer) ?? []).filter(
          (c) =>
            !visited.has(c) &&
            !placedAsPeerOf.has(c) &&
            !ownChildren.includes(c),
        )
      : [];
    const childIds = [...ownChildren, ...peerChildren];

    // ---- Leaf case (no children) ----
    if (childIds.length === 0) {
      const y = -depth * TreeLayout.LEVEL_HEIGHT;
      if (peer) {
        this.positions.set(nodeId, { x: xOffset, y, z: 0 });
        this.positions.set(peer, {
          x: xOffset + TreeLayout.PAIR_GAP_X,
          y,
          z: 0,
        });
        return TreeLayout.PAIR_GAP_X + TreeLayout.NODE_SPACING_X;
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
        pairsOf,
        visited,
        placedAsPeerOf,
      );
      // The child subtree may have been a pair — its rendered centre is
      // the midpoint of its first node and the previous cursor + width.
      const childPos = this.positions.get(childId);
      const childCentre = childPos
        ? childPos.x + (this.computeRenderedHalfWidth(childId, pairsOf) ?? 0)
        : childCursor;
      childCentres.push(childCentre);
      childCursor += subtreeWidth;
    }

    const childrenSpan = childCursor - xOffset;
    const childrenCentre =
      (childCentres[0] + childCentres[childCentres.length - 1]) / 2;

    const y = -depth * TreeLayout.LEVEL_HEIGHT;
    if (peer) {
      // Pair spans `PAIR_GAP_X` and is centred over the children.
      const pairCentre = childrenCentre;
      const left = pairCentre - TreeLayout.PAIR_GAP_X / 2;
      const right = pairCentre + TreeLayout.PAIR_GAP_X / 2;
      this.positions.set(nodeId, { x: left, y, z: 0 });
      this.positions.set(peer, { x: right, y, z: 0 });
    } else {
      this.positions.set(nodeId, { x: childrenCentre, y, z: 0 });
    }

    return Math.max(childrenSpan, TreeLayout.NODE_SPACING_X);
  }

  /**
   * Half the rendered width of a node when it might be paired with a
   * peer. Returns 0 for a solo node, `PAIR_GAP_X / 2` for a paired
   * node — this is used so {@link layoutSubtree} can compute the
   * children-centre relative to the paired pair's bounding box rather
   * than the primary node's centre alone.
   */
  private computeRenderedHalfWidth(
    nodeId: NodeId,
    pairsOf: Map<NodeId, Set<NodeId>>,
  ): number {
    const candidates = pairsOf.get(nodeId);
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

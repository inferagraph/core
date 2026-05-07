import type { NodeId, Vector3, LayoutOptions } from '../types.js';

export abstract class LayoutEngine {
  protected options: LayoutOptions;

  constructor(options?: LayoutOptions) {
    this.options = options ?? {};
  }

  /** Whether this layout should animate continuously */
  get animated(): boolean {
    return this.options.animated ?? true;
  }

  /** Update options at runtime */
  setOptions(options: LayoutOptions): void {
    this.options = { ...this.options, ...options };
  }

  abstract readonly name: string;

  abstract compute(
    nodeIds: NodeId[],
    edges: Array<LayoutEdgeInput>,
  ): Map<NodeId, Vector3>;

  abstract tick(): void;

  abstract getPositions(): Map<NodeId, Vector3>;

  /**
   * Canonical center the renderer should aim the camera at, or `null` if
   * the layout has no canonical center (e.g. force-directed layouts whose
   * cluster wanders during simulation).
   *
   * Returning a non-null origin is how a layout opts out of the
   * `frameToFit` percentile-midpoint heuristic: the camera target is set
   * directly to `{x, y, z?}` returned here. This stabilizes camera
   * framing for layouts that already place their nodes around a known
   * center (the tidy-tree layout recenters horizontally around x=0, so
   * its origin is `{x: 0, y: <vertical box midpoint>}`); without it the
   * percentile midpoint can drift off the canonical center whenever
   * traversal order shifts (a new default for `parentEdgeTypes`, a
   * different forest-root iteration order, etc.) and the camera frames
   * the wrong point.
   *
   * Implementations should return `null` rather than throwing when
   * called before `compute` has run.
   */
  abstract getOrigin(): { x: number; y: number; z?: number } | null;
}

/**
 * Edge input shape consumed by {@link LayoutEngine.compute}. The optional
 * `type` is the raw `EdgeAttributes.type` string (e.g. `parent_of`,
 * `manages`, `cites`); layouts that care about hierarchy (the tree
 * layout) consult it, layouts that don't (force-directed) ignore it.
 */
export interface LayoutEdgeInput {
  sourceId: NodeId;
  targetId: NodeId;
  type?: string;
}

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

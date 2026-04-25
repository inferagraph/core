import type { NodeId, Vector3 } from '../types.js';

export abstract class LayoutEngine {
  abstract readonly name: string;

  abstract compute(
    nodeIds: NodeId[],
    edges: Array<{ sourceId: NodeId; targetId: NodeId }>,
  ): Map<NodeId, Vector3>;

  abstract tick(): void;

  abstract getPositions(): Map<NodeId, Vector3>;
}

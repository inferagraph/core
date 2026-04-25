import type { NodeId, Vector3 } from '../types.js';
import { LayoutEngine } from './LayoutEngine.js';

export class TreeLayout extends LayoutEngine {
  readonly name = 'tree';
  private positions = new Map<NodeId, Vector3>();

  compute(
    nodeIds: NodeId[],
    edges: Array<{ sourceId: NodeId; targetId: NodeId }>,
  ): Map<NodeId, Vector3> {
    this.positions.clear();

    if (nodeIds.length === 0) return this.positions;

    const children = new Map<NodeId, NodeId[]>();
    const hasParent = new Set<NodeId>();

    for (const edge of edges) {
      if (!children.has(edge.sourceId)) {
        children.set(edge.sourceId, []);
      }
      children.get(edge.sourceId)!.push(edge.targetId);
      hasParent.add(edge.targetId);
    }

    const roots = nodeIds.filter((id) => !hasParent.has(id));
    const root = roots[0] ?? nodeIds[0];

    this.layoutSubtree(root, children, 0, 0, 200);
    return this.positions;
  }

  tick(): void {
    // Tree layout is static
  }

  getPositions(): Map<NodeId, Vector3> {
    return this.positions;
  }

  private layoutSubtree(
    nodeId: NodeId,
    children: Map<NodeId, NodeId[]>,
    depth: number,
    xOffset: number,
    spacing: number,
  ): number {
    const childIds = children.get(nodeId) ?? [];

    if (childIds.length === 0) {
      this.positions.set(nodeId, { x: xOffset, y: -depth * 100, z: 0 });
      return spacing;
    }

    let totalWidth = 0;
    const childPositions: number[] = [];

    for (const childId of childIds) {
      const width = this.layoutSubtree(childId, children, depth + 1, xOffset + totalWidth, spacing);
      childPositions.push(xOffset + totalWidth + width / 2);
      totalWidth += width;
    }

    const x = (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
    this.positions.set(nodeId, { x, y: -depth * 100, z: 0 });
    return totalWidth;
  }
}

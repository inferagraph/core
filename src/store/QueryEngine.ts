import type { NodeId } from '../types.js';
import type { GraphStore } from './GraphStore.js';
import type { Node } from './Node.js';

export class QueryEngine {
  constructor(private readonly store: GraphStore) {}

  getNeighbors(nodeId: NodeId, depth: number = 1): Node[] {
    const visited = new Set<NodeId>();
    const queue: Array<{ id: NodeId; currentDepth: number }> = [{ id: nodeId, currentDepth: 0 }];
    visited.add(nodeId);

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;
      if (currentDepth >= depth) continue;

      for (const neighborId of this.store.getNeighborIds(id)) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
        }
      }
    }

    visited.delete(nodeId);
    return [...visited].map((id) => this.store.getNode(id)!).filter(Boolean);
  }

  findPath(fromId: NodeId, toId: NodeId): NodeId[] | null {
    if (fromId === toId) return [fromId];

    const visited = new Set<NodeId>();
    const parent = new Map<NodeId, NodeId>();
    const queue: NodeId[] = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighborId of this.store.getNeighborIds(current)) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parent.set(neighborId, current);
          if (neighborId === toId) {
            return this.reconstructPath(parent, fromId, toId);
          }
          queue.push(neighborId);
        }
      }
    }

    return null;
  }

  getSubgraph(nodeIds: NodeId[]): { nodeIds: NodeId[]; edgeIds: string[] } {
    const nodeSet = new Set(nodeIds);
    const edgeIds: string[] = [];

    for (const edge of this.store.getAllEdges()) {
      if (nodeSet.has(edge.sourceId) && nodeSet.has(edge.targetId)) {
        edgeIds.push(edge.id);
      }
    }

    return { nodeIds: [...nodeSet], edgeIds };
  }

  private reconstructPath(parent: Map<NodeId, NodeId>, from: NodeId, to: NodeId): NodeId[] {
    const path: NodeId[] = [to];
    let current = to;
    while (current !== from) {
      current = parent.get(current)!;
      path.unshift(current);
    }
    return path;
  }
}

import type { DataAdapter, DataAdapterConfig } from './DataAdapter.js';
import type {
  NodeId, NodeData, GraphData, ContentData,
  PaginationOptions, PaginatedResult, DataFilter,
} from '../types.js';

/**
 * Default DataAdapter for apps that load all data upfront.
 * Wraps an in-memory GraphData object and implements DataAdapter
 * by filtering, searching, and traversing the data locally.
 */
export class StaticDataAdapter implements DataAdapter {
  constructor(private readonly data: GraphData) {}

  async getInitialView(_config?: DataAdapterConfig): Promise<GraphData> {
    return this.data;
  }

  async getNode(id: NodeId): Promise<NodeData | undefined> {
    return this.data.nodes.find(n => n.id === id);
  }

  async getNeighbors(nodeId: NodeId, depth: number = 1): Promise<GraphData> {
    const visited = new Set<NodeId>([nodeId]);
    let frontier = new Set<NodeId>([nodeId]);

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<NodeId>();
      for (const nid of frontier) {
        for (const edge of this.data.edges) {
          if (edge.sourceId === nid && !visited.has(edge.targetId)) {
            nextFrontier.add(edge.targetId);
            visited.add(edge.targetId);
          }
          if (edge.targetId === nid && !visited.has(edge.sourceId)) {
            nextFrontier.add(edge.sourceId);
            visited.add(edge.sourceId);
          }
        }
      }
      frontier = nextFrontier;
    }

    const nodeIds = visited;
    const nodes = this.data.nodes.filter(n => nodeIds.has(n.id));
    const edges = this.data.edges.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));

    return { nodes, edges };
  }

  async findPath(fromId: NodeId, toId: NodeId): Promise<GraphData> {
    // Handle missing nodes
    const fromNode = this.data.nodes.find(n => n.id === fromId);
    const toNode = this.data.nodes.find(n => n.id === toId);
    if (!fromNode || !toNode) {
      return { nodes: [], edges: [] };
    }

    // Same node
    if (fromId === toId) {
      return { nodes: [fromNode], edges: [] };
    }

    // Build adjacency list
    const adjacency = new Map<NodeId, Array<{ neighborId: NodeId; edgeId: string }>>();
    for (const node of this.data.nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of this.data.edges) {
      adjacency.get(edge.sourceId)?.push({ neighborId: edge.targetId, edgeId: edge.id });
      adjacency.get(edge.targetId)?.push({ neighborId: edge.sourceId, edgeId: edge.id });
    }

    // BFS to find shortest path
    const visited = new Set<NodeId>([fromId]);
    const parent = new Map<NodeId, { parentId: NodeId; edgeId: string }>();
    const queue: NodeId[] = [fromId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toId) {
        break;
      }

      const neighbors = adjacency.get(current) ?? [];
      for (const { neighborId, edgeId } of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parent.set(neighborId, { parentId: current, edgeId });
          queue.push(neighborId);
        }
      }
    }

    // No path found
    if (!parent.has(toId)) {
      return { nodes: [], edges: [] };
    }

    // Reconstruct path
    const pathNodeIds: NodeId[] = [];
    const pathEdgeIds = new Set<string>();
    let current: NodeId = toId;
    while (current !== fromId) {
      pathNodeIds.push(current);
      const parentInfo = parent.get(current)!;
      pathEdgeIds.add(parentInfo.edgeId);
      current = parentInfo.parentId;
    }
    pathNodeIds.push(fromId);
    pathNodeIds.reverse();

    const pathNodeIdSet = new Set(pathNodeIds);
    const nodes = this.data.nodes.filter(n => pathNodeIdSet.has(n.id));
    const edges = this.data.edges.filter(e => pathEdgeIds.has(e.id));

    return { nodes, edges };
  }

  async search(query: string, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> {
    const lowerQuery = query.toLowerCase();
    const matches = this.data.nodes.filter(node =>
      Object.values(node.attributes).some(val => {
        if (typeof val === 'string') return val.toLowerCase().includes(lowerQuery);
        if (Array.isArray(val)) return val.some(v => typeof v === 'string' && v.toLowerCase().includes(lowerQuery));
        return false;
      }),
    );

    return this.paginate(matches, pagination);
  }

  async filter(filter: DataFilter, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>> {
    let results = [...this.data.nodes];

    if (filter.types?.length) {
      results = results.filter(n => filter.types!.includes(n.attributes.type as string));
    }
    if (filter.tags?.length) {
      results = results.filter(n => {
        const tags = n.attributes.tags;
        if (!Array.isArray(tags)) return false;
        return filter.tags!.some(t => tags.includes(t));
      });
    }
    if (filter.attributes) {
      for (const [key, value] of Object.entries(filter.attributes)) {
        results = results.filter(n => n.attributes[key] === value);
      }
    }
    if (filter.search) {
      const searchResult = await this.search(filter.search);
      const searchIds = new Set(searchResult.items.map(n => n.id));
      results = results.filter(n => searchIds.has(n.id));
    }

    return this.paginate(results, pagination);
  }

  async getContent(nodeId: NodeId): Promise<ContentData | undefined> {
    const node = this.data.nodes.find(n => n.id === nodeId);
    if (!node || typeof node.attributes.content !== 'string') return undefined;
    return {
      nodeId,
      content: node.attributes.content as string,
      contentType: (node.attributes.contentType as string) ?? 'text',
    };
  }

  private paginate(items: NodeData[], pagination?: PaginationOptions): PaginatedResult<NodeData> {
    const total = items.length;
    if (!pagination) {
      return { items, total, hasMore: false };
    }
    const { offset, limit } = pagination;
    const sliced = items.slice(offset, offset + limit);
    return {
      items: sliced,
      total,
      hasMore: offset + limit < total,
    };
  }
}

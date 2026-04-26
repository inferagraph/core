import type { NodeId, EdgeId, NodeAttributes, EdgeAttributes, GraphData, SerializedGraph } from '../types.js';
import { Node } from './Node.js';
import { Edge } from './Edge.js';
import { Indexer } from './Indexer.js';

export class GraphStore {
  private nodes = new Map<NodeId, Node>();
  private edges = new Map<EdgeId, Edge>();
  private adjacency = new Map<NodeId, Set<EdgeId>>();
  private readonly indexer = new Indexer();

  addNode(id: NodeId, attributes: NodeAttributes): Node {
    if (this.nodes.has(id)) {
      throw new Error(`Node with id "${id}" already exists`);
    }
    const node = new Node(id, attributes);
    this.nodes.set(id, node);
    this.adjacency.set(id, new Set());
    this.indexer.addNode(node);
    return node;
  }

  removeNode(id: NodeId): void {
    const node = this.nodes.get(id);
    if (!node) return;

    const edgeIds = this.adjacency.get(id) ?? new Set();
    for (const edgeId of edgeIds) {
      this.removeEdge(edgeId);
    }

    this.indexer.removeNode(node);
    this.nodes.delete(id);
    this.adjacency.delete(id);
  }

  getNode(id: NodeId): Node | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  addEdge(id: EdgeId, sourceId: NodeId, targetId: NodeId, attributes: EdgeAttributes): Edge {
    if (this.edges.has(id)) {
      throw new Error(`Edge with id "${id}" already exists`);
    }
    if (!this.nodes.has(sourceId)) {
      throw new Error(`Source node "${sourceId}" not found`);
    }
    if (!this.nodes.has(targetId)) {
      throw new Error(`Target node "${targetId}" not found`);
    }

    const edge = new Edge(id, sourceId, targetId, attributes);
    this.edges.set(id, edge);
    this.adjacency.get(sourceId)!.add(id);
    this.adjacency.get(targetId)!.add(id);
    return edge;
  }

  removeEdge(id: EdgeId): void {
    const edge = this.edges.get(id);
    if (!edge) return;

    this.adjacency.get(edge.sourceId)?.delete(id);
    this.adjacency.get(edge.targetId)?.delete(id);
    this.edges.delete(id);
  }

  getEdge(id: EdgeId): Edge | undefined {
    return this.edges.get(id);
  }

  hasEdge(id: EdgeId): boolean {
    return this.edges.has(id);
  }

  getEdgesForNode(nodeId: NodeId): Edge[] {
    const edgeIds = this.adjacency.get(nodeId) ?? new Set();
    return [...edgeIds].map((id) => this.edges.get(id)!).filter(Boolean);
  }

  getNeighborIds(nodeId: NodeId): NodeId[] {
    const edges = this.getEdgesForNode(nodeId);
    const neighbors = new Set<NodeId>();
    for (const edge of edges) {
      if (edge.sourceId === nodeId) neighbors.add(edge.targetId);
      if (edge.targetId === nodeId) neighbors.add(edge.sourceId);
    }
    return [...neighbors];
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    return this.edges.size;
  }

  getAllNodes(): Node[] {
    return [...this.nodes.values()];
  }

  getAllEdges(): Edge[] {
    return [...this.edges.values()];
  }

  getNodesByType(type: string): Node[] {
    const ids = this.indexer.getByType(type);
    return [...ids].map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  getNodesByTag(tag: string): Node[] {
    const ids = this.indexer.getByTag(tag);
    return [...ids].map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  getNodeByName(name: string): Node | undefined {
    const id = this.indexer.getByName(name);
    return id ? this.nodes.get(id) : undefined;
  }

  loadData(data: GraphData): void {
    for (const nodeData of data.nodes) {
      this.addNode(nodeData.id, nodeData.attributes);
    }
    for (const edgeData of data.edges) {
      this.addEdge(edgeData.id, edgeData.sourceId, edgeData.targetId, edgeData.attributes);
    }
  }

  /**
   * Merge new graph data into the store without clearing existing data.
   * Nodes that already exist (by ID) are skipped.
   * Edges that already exist (by ID) are skipped.
   */
  merge(data: GraphData): void {
    for (const nodeData of data.nodes) {
      if (!this.hasNode(nodeData.id)) {
        this.addNode(nodeData.id, nodeData.attributes);
      }
    }
    for (const edgeData of data.edges) {
      if (!this.hasEdge(edgeData.id)) {
        this.addEdge(edgeData.id, edgeData.sourceId, edgeData.targetId, edgeData.attributes);
      }
    }
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();
    this.indexer.clear();
  }

  toJSON(): SerializedGraph {
    return {
      version: 1,
      nodes: Array.from(this.nodes.values()).map(n => ({
        id: n.id,
        attributes: { ...n.attributes },
      })),
      edges: Array.from(this.edges.values()).map(e => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        attributes: { ...e.attributes },
      })),
      metadata: {
        exportedAt: new Date().toISOString(),
        nodeCount: this.nodeCount,
        edgeCount: this.edgeCount,
      },
    };
  }

  fromJSON(data: SerializedGraph): void {
    if (!data || data.version !== 1) {
      throw new Error(`Unsupported schema version: ${data?.version}`);
    }
    this.clear();
    this.loadData({ nodes: data.nodes, edges: data.edges });
  }
}

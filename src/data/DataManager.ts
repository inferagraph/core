import type { DataAdapter, DataAdapterConfig } from './DataAdapter.js';
import type { NodeId, NodeData, ContentData, PaginatedResult } from '../types.js';

/** Minimal store interface required by DataManager */
interface MergeableStore {
  merge(data: { nodes: NodeData[]; edges: unknown[] }): void;
}

/**
 * Bridges async DataAdapter to sync GraphStore.
 * Manages caching of which nodes have been fetched and
 * merges adapter results into the store.
 */
export class DataManager {
  private readonly adapter: DataAdapter;
  private readonly store: MergeableStore;
  private readonly fetchedNodes = new Set<NodeId>();
  private initialized = false;

  constructor(store: MergeableStore, adapter: DataAdapter) {
    this.adapter = adapter;
    this.store = store;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Initialize: call adapter.getInitialView(), merge into store */
  async initialize(config?: DataAdapterConfig): Promise<void> {
    const data = await this.adapter.getInitialView(config);
    this.store.merge(data);
    for (const node of data.nodes) {
      this.fetchedNodes.add(node.id);
    }
    this.initialized = true;
  }

  /** Expand a node: fetch neighbors and merge into store */
  async expandNode(nodeId: NodeId, depth?: number): Promise<void> {
    const data = await this.adapter.getNeighbors(nodeId, depth);
    this.store.merge(data);
    for (const node of data.nodes) {
      this.fetchedNodes.add(node.id);
    }
  }

  /** Find path: fetch path subgraph, merge into store, return path nodes */
  async findPath(fromId: NodeId, toId: NodeId): Promise<NodeData[]> {
    const data = await this.adapter.findPath(fromId, toId);
    this.store.merge(data);
    for (const node of data.nodes) {
      this.fetchedNodes.add(node.id);
    }
    return data.nodes;
  }

  /** Search: delegates to adapter, returns results (doesn't auto-add to store) */
  async search(query: string): Promise<PaginatedResult<NodeData>> {
    return this.adapter.search(query);
  }

  /** Get content for detail panel */
  async getContent(nodeId: NodeId): Promise<ContentData | undefined> {
    return this.adapter.getContent(nodeId);
  }

  /** Check if a node has been fetched */
  hasFetched(nodeId: NodeId): boolean {
    return this.fetchedNodes.has(nodeId);
  }
}

import type {
  NodeId, NodeData, GraphData, ContentData,
  PaginationOptions, PaginatedResult, DataFilter,
} from '../types.js';

/** Configuration passed to the adapter during initialization */
export interface DataAdapterConfig {
  [key: string]: unknown;
}

/** Interface for fetching graph data from any source */
export interface DataAdapter {
  /** Called once when InferaGraph initializes. Return the starting subgraph. */
  getInitialView(config?: DataAdapterConfig): Promise<GraphData>;

  /** Get a single node by ID */
  getNode(id: NodeId): Promise<NodeData | undefined>;

  /** Get direct neighbors of a node (1-hop by default). Used when user clicks/expands a node. */
  getNeighbors(nodeId: NodeId, depth?: number): Promise<GraphData>;

  /** Find a path between two nodes. Used for lineage/connection queries. */
  findPath(fromId: NodeId, toId: NodeId): Promise<GraphData>;

  /** Search nodes by text query. Used by search UI. */
  search(query: string, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>>;

  /** Filter nodes by criteria. Used by filter panel. */
  filter(filter: DataFilter, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>>;

  /** Get content/details for a node. Used when detail panel opens. */
  getContent(nodeId: NodeId): Promise<ContentData | undefined>;
}

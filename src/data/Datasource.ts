import type { DataAdapter, DataAdapterConfig } from './DataAdapter.js';
import type {
  NodeId, NodeData, GraphData, ContentData,
  PaginationOptions, PaginatedResult, DataFilter,
} from '../types.js';

/**
 * Abstract base class for server-side datasource implementations.
 * Extends the DataAdapter interface with lifecycle management
 * (connect/disconnect) for datasources that need persistent connections.
 */
export abstract class Datasource implements DataAdapter {
  /** Human-readable name of the datasource */
  abstract readonly name: string;

  /** Connect to the data source */
  abstract connect(): Promise<void>;

  /** Disconnect from the data source */
  abstract disconnect(): Promise<void>;

  /** Check if currently connected */
  abstract isConnected(): boolean;

  // DataAdapter methods
  abstract getInitialView(config?: DataAdapterConfig): Promise<GraphData>;
  abstract getNode(id: NodeId): Promise<NodeData | undefined>;
  abstract getNeighbors(nodeId: NodeId, depth?: number): Promise<GraphData>;
  abstract findPath(fromId: NodeId, toId: NodeId): Promise<GraphData>;
  abstract search(query: string, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>>;
  abstract filter(filter: DataFilter, pagination?: PaginationOptions): Promise<PaginatedResult<NodeData>>;
  abstract getContent(nodeId: NodeId): Promise<ContentData | undefined>;
}

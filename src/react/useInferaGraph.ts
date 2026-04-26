import { useCallback } from 'react';
import { useGraphContext } from './GraphProvider.js';
import type { GraphData, AIQueryResult, NodeId, NodeData, ContentData, PaginatedResult } from '../types.js';

export interface UseInferaGraphReturn {
  // existing
  loadData: (data: GraphData) => void;
  query: (question: string) => Promise<AIQueryResult>;
  nodeCount: number;
  edgeCount: number;
  // new
  expandNode: (nodeId: NodeId, depth?: number) => Promise<void>;
  findPath: (fromId: NodeId, toId: NodeId) => Promise<NodeData[]>;
  search: (query: string) => Promise<PaginatedResult<NodeData>>;
  getContent: (nodeId: NodeId) => Promise<ContentData | undefined>;
  isReady: boolean;
}

export function useInferaGraph(): UseInferaGraphReturn {
  const { store, aiEngine, dataManager, isReady } = useGraphContext();

  const expandNode = useCallback(async (nodeId: NodeId, depth?: number): Promise<void> => {
    if (!dataManager) return;
    await dataManager.expandNode(nodeId, depth);
  }, [dataManager]);

  const findPath = useCallback(async (fromId: NodeId, toId: NodeId): Promise<NodeData[]> => {
    if (!dataManager) return [];
    return dataManager.findPath(fromId, toId);
  }, [dataManager]);

  const search = useCallback(async (query: string): Promise<PaginatedResult<NodeData>> => {
    if (!dataManager) return { items: [], total: 0, hasMore: false };
    return dataManager.search(query);
  }, [dataManager]);

  const getContent = useCallback(async (nodeId: NodeId): Promise<ContentData | undefined> => {
    if (!dataManager) return undefined;
    return dataManager.getContent(nodeId);
  }, [dataManager]);

  return {
    loadData: (data: GraphData) => store.loadData(data),
    query: (question: string) => aiEngine.query(question),
    nodeCount: store.nodeCount,
    edgeCount: store.edgeCount,
    expandNode,
    findPath,
    search,
    getContent,
    isReady,
  };
}

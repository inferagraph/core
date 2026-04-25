import { useGraphContext } from './GraphProvider.js';
import type { GraphData, AIQueryResult } from '../types.js';

export interface UseInferaGraphReturn {
  loadData: (data: GraphData) => void;
  query: (question: string) => Promise<AIQueryResult>;
  nodeCount: number;
  edgeCount: number;
}

export function useInferaGraph(): UseInferaGraphReturn {
  const { store, aiEngine } = useGraphContext();

  return {
    loadData: (data: GraphData) => store.loadData(data),
    query: (question: string) => aiEngine.query(question),
    nodeCount: store.nodeCount,
    edgeCount: store.edgeCount,
  };
}

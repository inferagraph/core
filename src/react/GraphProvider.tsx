import React, { createContext, useContext, useRef, type ReactNode } from 'react';
import { GraphStore } from '../store/GraphStore.js';
import { QueryEngine } from '../store/QueryEngine.js';
import { AIEngine } from '../ai/AIEngine.js';

interface GraphContextValue {
  store: GraphStore;
  queryEngine: QueryEngine;
  aiEngine: AIEngine;
}

const GraphContext = createContext<GraphContextValue | null>(null);

export interface GraphProviderProps {
  children: ReactNode;
}

export function GraphProvider({ children }: GraphProviderProps): React.JSX.Element {
  const storeRef = useRef<GraphStore>();
  if (!storeRef.current) {
    storeRef.current = new GraphStore();
  }

  const queryRef = useRef<QueryEngine>();
  if (!queryRef.current) {
    queryRef.current = new QueryEngine(storeRef.current);
  }

  const aiRef = useRef<AIEngine>();
  if (!aiRef.current) {
    aiRef.current = new AIEngine(storeRef.current, queryRef.current);
  }

  const value: GraphContextValue = {
    store: storeRef.current,
    queryEngine: queryRef.current,
    aiEngine: aiRef.current,
  };

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function useGraphContext(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) {
    throw new Error('useGraphContext must be used within a GraphProvider');
  }
  return ctx;
}

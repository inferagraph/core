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
  const storeRef = useRef<GraphStore>(null);
  if (!storeRef.current) {
    (storeRef as React.MutableRefObject<GraphStore>).current = new GraphStore();
  }

  const queryRef = useRef<QueryEngine>(null);
  if (!queryRef.current) {
    (queryRef as React.MutableRefObject<QueryEngine>).current = new QueryEngine(storeRef.current!);
  }

  const aiRef = useRef<AIEngine>(null);
  if (!aiRef.current) {
    (aiRef as React.MutableRefObject<AIEngine>).current = new AIEngine(storeRef.current!, queryRef.current!);
  }

  const value: GraphContextValue = {
    store: storeRef.current!,
    queryEngine: queryRef.current!,
    aiEngine: aiRef.current!,
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

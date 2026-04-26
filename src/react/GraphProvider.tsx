import React, { createContext, useContext, useRef, useEffect, useState, useCallback, type ReactNode } from 'react';
import { GraphStore } from '../store/GraphStore.js';
import { QueryEngine } from '../store/QueryEngine.js';
import { AIEngine } from '../ai/AIEngine.js';
import { DataManager } from '../data/DataManager.js';
import { StaticDataAdapter } from '../data/StaticDataAdapter.js';
import type { DataAdapter, DataAdapterConfig } from '../data/DataAdapter.js';
import type { GraphData } from '../types.js';

export interface GraphContextValue {
  store: GraphStore;
  queryEngine: QueryEngine;
  aiEngine: AIEngine;
  dataManager: DataManager | null;
}

const GraphContext = createContext<GraphContextValue | null>(null);

export interface GraphProviderProps {
  children: ReactNode;
  /** Static data (existing behavior — wraps in StaticDataAdapter) */
  data?: GraphData;
  /** DataAdapter for dynamic data fetching */
  adapter?: DataAdapter;
  /** Config passed to adapter.getInitialView() */
  initialViewConfig?: DataAdapterConfig;
  /** Called when initial data is loaded */
  onReady?: () => void;
}

export function GraphProvider({
  children,
  data,
  adapter,
  initialViewConfig,
  onReady,
}: GraphProviderProps): React.JSX.Element {
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

  const dataManagerRef = useRef<DataManager | null>(null);

  // Create DataManager from adapter or data prop
  const resolvedAdapter = adapter ?? (data ? new StaticDataAdapter(data) : null);

  if (!dataManagerRef.current && resolvedAdapter) {
    dataManagerRef.current = new DataManager(storeRef.current!, resolvedAdapter);
  }

  const [isReady, setIsReady] = useState(!resolvedAdapter);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const initialViewConfigRef = useRef(initialViewConfig);
  initialViewConfigRef.current = initialViewConfig;

  const initialize = useCallback(async () => {
    const dm = dataManagerRef.current;
    if (!dm) return;
    await dm.initialize(initialViewConfigRef.current);
    setIsReady(true);
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    if (resolvedAdapter && dataManagerRef.current && !dataManagerRef.current.isInitialized) {
      initialize();
    }
  }, [resolvedAdapter, initialize]);

  const value: GraphContextValue = {
    store: storeRef.current!,
    queryEngine: queryRef.current!,
    aiEngine: aiRef.current!,
    dataManager: dataManagerRef.current,
  };

  // Expose isReady through a second context or directly on the value
  // For simplicity, we'll store it on the value object
  (value as GraphContextValue & { isReady: boolean }).isReady = isReady;

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function useGraphContext(): GraphContextValue & { isReady: boolean } {
  const ctx = useContext(GraphContext);
  if (!ctx) {
    throw new Error('useGraphContext must be used within a GraphProvider');
  }
  return ctx as GraphContextValue & { isReady: boolean };
}

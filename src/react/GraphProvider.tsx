import React, { createContext, useContext, useRef, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
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

  // Create DataManager from adapter or data prop. The resolved adapter is
  // memoized on the (adapter, data) pair so we don't churn out a fresh
  // `StaticDataAdapter` on every render — that previously caused the
  // initialization `useEffect` below to refire on every parent re-render
  // (its dep array referenced the unmemoized adapter), which compounded
  // with downstream renderer effects and could produce a runaway render
  // loop on graphs with bidirectional edges.
  const resolvedAdapter = useMemo<DataAdapter | null>(
    () => adapter ?? (data ? new StaticDataAdapter(data) : null),
    [adapter, data],
  );

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

  // Memoize the context value so that consumer renders + downstream effects
  // (e.g. `InferaGraphInner`'s controller-mount effect) only fire when one
  // of the underlying engines or `isReady` actually changes. Without this
  // every render produces a fresh object reference, which makes any consumer
  // useEffect that depends on the destructured context unstable — the
  // observed symptom on graphs with bidirectional edges (`father_of` ↔
  // `son_of`) was a runaway re-render that exhausted the call stack.
  const value = useMemo<GraphContextValue & { isReady: boolean }>(
    () => ({
      store: storeRef.current!,
      queryEngine: queryRef.current!,
      aiEngine: aiRef.current!,
      dataManager: dataManagerRef.current,
      isReady,
    }),
    // dataManagerRef.current changes from null → DataManager exactly once
    // when `resolvedAdapter` first becomes non-null, so we depend on
    // `resolvedAdapter` to capture that transition. The store / query /
    // ai engines are created once per provider lifetime.
    [isReady, resolvedAdapter],
  );

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function useGraphContext(): GraphContextValue & { isReady: boolean } {
  const ctx = useContext(GraphContext);
  if (!ctx) {
    throw new Error('useGraphContext must be used within a GraphProvider');
  }
  return ctx as GraphContextValue & { isReady: boolean };
}

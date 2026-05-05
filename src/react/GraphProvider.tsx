import React, { createContext, useContext, useRef, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { GraphStore } from '../store/GraphStore.js';
import { QueryEngine } from '../store/QueryEngine.js';
import { AIEngine } from '../ai/AIEngine.js';
import { DataManager } from '../data/DataManager.js';
import { StaticDataAdapter } from '../data/StaticDataAdapter.js';
import { MemoryManager } from '../data/MemoryManager.js';
import type { DataAdapter, DataAdapterConfig } from '../data/DataAdapter.js';
import type { GraphData, NodeId } from '../types.js';

/**
 * Slug → node-id resolver. Hosts that route detail pages by human-readable
 * slug (e.g. `/person/adam`) supply this so the library can translate the
 * slug into the canonical node id used by the graph store + adapter.
 *
 * The sync escape hatch (`NodeId` instead of `Promise<NodeId>`) is
 * deliberate: biblegraph's slug→UUID v5 helper is purely deterministic and
 * doesn't need a microtask. Hooks always `await` the return so async
 * resolvers (database lookups, manifest fetches) work too.
 */
export type SlugResolver = (slug: string) => NodeId | Promise<NodeId>;

export interface GraphContextValue {
  store: GraphStore;
  queryEngine: QueryEngine;
  aiEngine: AIEngine;
  dataManager: DataManager | null;
  /**
   * LRU eviction coordinator. Always present, even when no `maxNodes` cap
   * is configured — `enforceCap` becomes a no-op in that case.
   */
  memoryManager: MemoryManager;
  /**
   * Active {@link SlugResolver}, or `undefined` when the host opted out.
   * Hooks check this before resolving — when undefined, they treat the
   * input as a raw NodeId (no slug→id translation).
   */
  slugResolver: SlugResolver | undefined;
  /**
   * Library-internal slug→nodeId cache. Slugs are immutable, so there's no
   * TTL — entries live for the GraphProvider's lifetime. Exposed on the
   * context value (rather than encapsulated) so the two hooks
   * (`useInferaGraphContent` + `useInferaGraphNeighbors`) share one cache.
   */
  slugCache: Map<string, NodeId>;
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
  /** Slug → nodeId resolver. See {@link SlugResolver}. */
  slugResolver?: SlugResolver;
  /**
   * Soft cap on the number of nodes retained in the {@link GraphStore}.
   * When the count exceeds the cap the {@link MemoryManager} evicts the
   * oldest non-protected entries. `undefined` (the default) disables the
   * cap so memory grows with the dataset.
   */
  maxNodes?: number;
  /** Called when initial data is loaded */
  onReady?: () => void;
}

export function GraphProvider({
  children,
  data,
  adapter,
  initialViewConfig,
  slugResolver,
  maxNodes,
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

  // Memory manager is created once per provider lifetime. The store +
  // aiEngine references are stable (refs above), so passing them in is
  // safe. `maxNodes` is updated through a separate ref + getter pattern
  // would be ideal but the cap is consulted only at `enforceCap()` time
  // and we recreate the MemoryManager when `maxNodes` actually changes
  // (see effect below) so the simple constructor capture works.
  const memoryManagerRef = useRef<MemoryManager>(null);
  if (!memoryManagerRef.current) {
    (memoryManagerRef as React.MutableRefObject<MemoryManager>).current =
      new MemoryManager(storeRef.current!, aiRef.current!, maxNodes);
  }

  // Re-instantiate the MemoryManager when the cap changes. This is rare
  // (host typically passes a constant) so the recreation cost is fine. We
  // deliberately keep the same store + aiEngine refs so the rest of the
  // pipeline doesn't notice.
  const lastMaxNodesRef = useRef<number | undefined>(maxNodes);
  if (lastMaxNodesRef.current !== maxNodes) {
    lastMaxNodesRef.current = maxNodes;
    (memoryManagerRef as React.MutableRefObject<MemoryManager>).current =
      new MemoryManager(storeRef.current!, aiRef.current!, maxNodes);
  }

  // Library-internal slug cache. Created once per provider lifetime.
  const slugCacheRef = useRef<Map<string, NodeId>>(null);
  if (!slugCacheRef.current) {
    (slugCacheRef as React.MutableRefObject<Map<string, NodeId>>).current = new Map();
  }

  // Resolve the active adapter from the (adapter, data) pair. Memoized so a
  // parent re-render with the same `data` reference doesn't churn out a
  // fresh `StaticDataAdapter`, which would otherwise spuriously trigger
  // the swap effect below.
  const resolvedAdapter = useMemo<DataAdapter | null>(
    () => adapter ?? (data ? new StaticDataAdapter(data) : null),
    [adapter, data],
  );

  const dataManagerRef = useRef<DataManager | null>(null);
  // Synchronously instantiate the DataManager on the first render that has
  // an adapter — this preserves the prior contract that consumers see a
  // non-null `dataManager` on initial render, AND keeps the context value
  // referentially stable across rerenders for the same data prop (no
  // post-mount generation bump that flips the memoized identity).
  if (!dataManagerRef.current && resolvedAdapter) {
    dataManagerRef.current = new DataManager(storeRef.current!, resolvedAdapter);
  }

  const [isReady, setIsReady] = useState(!resolvedAdapter);
  // Generation counter used as a useMemo dep so that an adapter SWAP (not
  // first mount) flips the context value identity even though the engines
  // + store refs are stable.
  const [dataManagerGeneration, setDataManagerGeneration] = useState(0);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const initialViewConfigRef = useRef(initialViewConfig);
  initialViewConfigRef.current = initialViewConfig;

  // Tracks DataManagers whose `initialize` is currently in-flight. We
  // can't rely on `dm.isInitialized` alone because that flag only flips
  // AFTER the await resolves — between effect re-runs (e.g. caused by a
  // sibling state setter inside the same swap path) we'd otherwise issue
  // a duplicate `initialize` call against the same manager.
  const inFlightInits = useRef(new WeakSet<DataManager>());

  const initialize = useCallback(async (dm: DataManager) => {
    if (dm.isInitialized) return;
    if (inFlightInits.current.has(dm)) return;
    inFlightInits.current.add(dm);
    try {
      await dm.initialize(initialViewConfigRef.current);
    } finally {
      inFlightInits.current.delete(dm);
    }
    // Only flip ready if this DataManager is still the active one — a
    // newer adapter swap may have superseded us mid-flight.
    if (dataManagerRef.current === dm) {
      setIsReady(true);
      onReadyRef.current?.();
    }
  }, []);

  // Adapter-swap effect. Drives:
  //   - Initial mount: just kick off `initialize` for the synchronously
  //     created DataManager. No generation bump (the value's deps already
  //     include `resolvedAdapter` indirectly via `dataManagerRef.current`).
  //   - Adapter change: clear the store, drop the existing DataManager,
  //     instantiate a fresh one, bump the generation counter so the
  //     context value's identity flips, flip `isReady` to false, then
  //     re-run `initialize`.
  // Filter changes don't run through here — they go through
  // `controller.setFilter()` (in-place visibility toggle).
  useEffect(() => {
    if (!resolvedAdapter) {
      if (dataManagerRef.current) {
        // Adapter removed mid-life — drop the manager + clear the store.
        storeRef.current!.clear();
        dataManagerRef.current = null;
        setDataManagerGeneration((g) => g + 1);
      }
      if (!isReady) setIsReady(true);
      return;
    }

    const existing = dataManagerRef.current;
    if (existing && existing.adapter === resolvedAdapter) {
      // First-mount path or unchanged adapter: kick off init if it
      // hasn't already run. No generation bump here — the synchronously
      // created manager is already present in the rendered context value.
      if (!existing.isInitialized) {
        void initialize(existing);
      }
      return;
    }

    // Swap path: wipe the store so stale nodes from the prior adapter
    // don't leak into the new view. The renderer's mesh-rebuild effect
    // (`isReady` transition false→true) will pick up the fresh data
    // for free.
    storeRef.current!.clear();
    setIsReady(false);

    const fresh = new DataManager(storeRef.current!, resolvedAdapter);
    dataManagerRef.current = fresh;
    setDataManagerGeneration((g) => g + 1);
    void initialize(fresh);
  }, [resolvedAdapter, initialize, isReady]);

  // Memoize the context value so consumer renders only see a fresh
  // identity when one of the underlying engines, the slug resolver, the
  // ready flag, OR the DataManager generation changes. The slugCache
  // map is mutated in place — its identity is stable across renders.
  //
  // We deliberately include `resolvedAdapter` in the deps so that the
  // FIRST render after the synchronous `dataManagerRef` populates picks
  // up the new manager identity (matches the prior 0.5.0 behavior where
  // `resolvedAdapter` was the dep that flipped on mount).
  const value = useMemo<GraphContextValue & { isReady: boolean }>(
    () => ({
      store: storeRef.current!,
      queryEngine: queryRef.current!,
      aiEngine: aiRef.current!,
      dataManager: dataManagerRef.current,
      memoryManager: memoryManagerRef.current!,
      slugResolver,
      slugCache: slugCacheRef.current!,
      isReady,
    }),
    [isReady, dataManagerGeneration, resolvedAdapter, slugResolver],
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

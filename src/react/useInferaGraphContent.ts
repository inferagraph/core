import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphContext } from './GraphProvider.js';
import type { ContentData, NodeId } from '../types.js';

/**
 * Return shape of {@link useInferaGraphContent}.
 *
 * Mirrors the host-friendly fetch-state quartet (data + loading + error +
 * refetch). All four fields are always populated — `loading` is `false`
 * when `idOrSlug` is `undefined`, so hosts don't need conditional rendering
 * gymnastics.
 */
export interface UseInferaGraphContentReturn {
  /** Fetched content, or `undefined` while loading / on error / for invalid input. */
  data: ContentData | undefined;
  /** `true` while a fetch is in flight (or queued for the current id). */
  loading: boolean;
  /** Last error encountered, or `undefined` on success / before first fetch. */
  error: Error | undefined;
  /** Imperatively re-run the fetch for the current id. No-op when id is undefined. */
  refetch: () => void;
}

/**
 * Tier-1 cache for getContent results. Keyed by canonical NodeId (post slug
 * resolution). Populated on every successful fetch; consulted before issuing
 * a network call so re-mounted DetailModals don't re-fetch.
 *
 * Lives at module scope intentionally: the GraphProvider context value is
 * recreated on adapter swap, but that swap also wipes the store and would
 * make any cached content stale. We mirror that lifecycle by clearing this
 * Map whenever the dataManager identity flips (see effect below).
 */

/**
 * React hook that fetches detail content for one node.
 *
 * Workflow:
 *   1. If `idOrSlug` is `undefined`, return a disabled-state object — no
 *      fetch fires, no spinner.
 *   2. Pass the input through the configured {@link SlugResolver}. When the
 *      host opted out (no resolver), the input is treated as a raw NodeId.
 *   3. Hit the per-DataManager cache. On hit, return immediately; on miss,
 *      call `dataManager.getContent(uuid)` and cache the result.
 *   4. Touch the {@link MemoryManager} so the node moves to the MRU end
 *      and survives any subsequent cap-enforcement pass.
 *   5. Cancel via the standard "captured-token" pattern when the input
 *      changes mid-flight; `setData` only fires for the latest call.
 *
 * MUST be called inside an `<InferaGraph>` (or standalone `<GraphProvider>`)
 * subtree.
 */
export function useInferaGraphContent(
  idOrSlug: string | undefined,
): UseInferaGraphContentReturn {
  const { dataManager, memoryManager, slugResolver, slugCache } = useGraphContext();

  const [data, setData] = useState<ContentData | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Per-hook content cache. Keyed by canonical NodeId. Refreshes when the
  // dataManager identity flips (an adapter swap clears the store, which
  // would make old content stale).
  const contentCacheRef = useRef<Map<NodeId, ContentData | undefined>>(new Map());
  const lastDataManagerRef = useRef(dataManager);
  if (lastDataManagerRef.current !== dataManager) {
    lastDataManagerRef.current = dataManager;
    contentCacheRef.current = new Map();
  }

  // Reset-and-fetch counter so refetch + idOrSlug changes both kick a new
  // run. The latest counter wins; older runs early-out when they see a
  // cancelled token.
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (!idOrSlug) {
      setData(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }
    if (!dataManager) {
      // No data path wired — return undefined data without spinning forever.
      setData(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    const run = async () => {
      try {
        // Resolve slug → uuid. When no resolver is configured, treat the
        // input as a raw id. Cache slug→uuid pairs in the shared cache so
        // a follow-up `useInferaGraphNeighbors.expand(slug)` hits without
        // re-resolving.
        let nodeId: NodeId;
        if (slugResolver) {
          const cached = slugCache.get(idOrSlug);
          if (cached !== undefined) {
            nodeId = cached;
          } else {
            nodeId = await slugResolver(idOrSlug);
            slugCache.set(idOrSlug, nodeId);
          }
        } else {
          nodeId = idOrSlug;
        }
        if (cancelled) return;

        // Cache hit?
        if (contentCacheRef.current.has(nodeId)) {
          const hit = contentCacheRef.current.get(nodeId);
          setData(hit);
          setLoading(false);
          // Still touch — the user re-opened this node, so it should
          // count as "recently used" for LRU purposes.
          memoryManager.touch(nodeId);
          return;
        }

        const result = await dataManager.getContent(nodeId);
        if (cancelled) return;

        contentCacheRef.current.set(nodeId, result);
        memoryManager.touch(nodeId);
        setData(result);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setData(undefined);
        setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [idOrSlug, dataManager, memoryManager, slugResolver, slugCache, refetchTick]);

  const refetch = useCallback(() => {
    if (!idOrSlug) return;
    // Drop the cached entry so the new fetch actually round-trips.
    if (slugResolver) {
      const uuid = slugCache.get(idOrSlug);
      if (uuid !== undefined) contentCacheRef.current.delete(uuid);
    } else {
      contentCacheRef.current.delete(idOrSlug);
    }
    setRefetchTick((t) => t + 1);
  }, [idOrSlug, slugResolver, slugCache]);

  return { data, loading, error, refetch };
}

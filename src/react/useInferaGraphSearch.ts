import { useCallback, useRef } from 'react';
import { useGraphContext } from './GraphProvider.js';
import type { SearchResult } from '../ai/SearchResult.js';

/**
 * Public return shape of {@link useInferaGraphSearch}. The hook returns a
 * single `search(query)` function that delegates to the AIEngine's
 * auto-detect router (keyword vs semantic).
 *
 * Pair with `<InferaGraph>` props:
 *   - `llm` — required for semantic routing.
 *   - `cache` — opts the engine into Tier 2 (cache-as-vector-store).
 *   - `embeddingStore` — opts the engine into Tier 3 (vector-native store).
 *   Without `llm`, every query falls back to the data-layer keyword search.
 */
export interface InferaGraphSearchHook {
  /**
   * Run an auto-routed search. Short token-only queries hit the data-layer
   * keyword index; sentence-shaped or NLQ inputs go through embeddings.
   *
   * Returns at most `opts.k ?? 25` hits, sorted by descending score.
   */
  search: (
    query: string,
    opts?: { k?: number; signal?: AbortSignal },
  ) => Promise<SearchResult[]>;
}

/**
 * React hook surfacing InferaGraph's Phase 4 search API.
 *
 * Internally:
 *   1. Pulls the {@link AIEngine} out of the GraphContext (populated by
 *      `<InferaGraph>` / `<GraphProvider>`).
 *   2. Wraps `engine.search` in a stable `useCallback` so consumers can
 *      memoize / debounce without identity churn.
 *   3. Holds the engine behind a ref so prop changes on the host don't
 *      invalidate the callback.
 *
 * MUST be called inside an `<InferaGraph>` (or standalone `<GraphProvider>`)
 * subtree.
 */
export function useInferaGraphSearch(): InferaGraphSearchHook {
  const ctx = useGraphContext();
  const engineRef = useRef(ctx.aiEngine);
  engineRef.current = ctx.aiEngine;

  const search = useCallback(
    (query: string, opts?: { k?: number; signal?: AbortSignal }) => {
      return engineRef.current.search(query, opts);
    },
    [],
  );

  return { search };
}

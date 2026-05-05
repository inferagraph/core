import { useCallback, useRef, useState } from 'react';
import { useGraphContext } from './GraphProvider.js';
import type { NodeId } from '../types.js';

/** Lifecycle status of a single expand call, tracked per-nodeId. */
export type NeighborStatus = 'loading' | 'loaded' | 'error';

/**
 * Return shape of {@link useInferaGraphNeighbors}.
 *
 * Imperative hook (not a fetch-on-mount hook): the host calls `expand` /
 * `collapse` in response to user actions (click on the "+" affordance,
 * keyboard shortcut, chat tool call). Reading `expanded` is enough for the
 * host to know which nodes are currently in flight or already drilled-down.
 */
export interface UseInferaGraphNeighborsReturn {
  /**
   * Fetch direct neighbors of `nodeId` (depth defaults to 1). Resolves slug
   * via the configured resolver, calls `dataManager.expandNode`, syncs the
   * scene from the freshly-merged store, and enforces the LRU cap with the
   * just-expanded set marked as protected (so eviction never targets the
   * neighbors the user just asked to see).
   */
  expand: (nodeIdOrSlug: string, depth?: number) => Promise<void>;
  /**
   * Remove neighbors of `nodeId` that aren't in the protected initial-view
   * set. Inverse of `expand`. Implementations of "protected" are
   * intentionally simple v1: any node currently visible due to another
   * expand still survives because its LRU timestamp is fresher than the
   * collapsing nodes.
   */
  collapse: (nodeIdOrSlug: string) => Promise<void>;
  /** Per-node lifecycle map. Keys are CANONICAL NodeIds (post-resolution). */
  expanded: ReadonlyMap<NodeId, NeighborStatus>;
}

/**
 * React hook that exposes drilldown / collapse imperatives.
 *
 * Slug-aware: callers may pass either a UUID or a slug. The configured
 * {@link SlugResolver} translates slugs to canonical NodeIds; the resolved
 * id is what survives in `expanded` so the host can reason about identity
 * uniformly.
 *
 * Race-safe: each call captures its own resolved nodeId before awaiting,
 * and the returned promise reflects the outcome of THIS call. If a faster
 * second `expand(sameNode)` overlaps a slow first one, both promises
 * resolve correctly because the underlying `dataManager.expandNode` merges
 * by id (later merges are no-ops for nodes already present).
 *
 * MUST be called inside an `<InferaGraph>` (or standalone `<GraphProvider>`)
 * subtree.
 */
export function useInferaGraphNeighbors(): UseInferaGraphNeighborsReturn {
  const { store, dataManager, memoryManager, slugResolver, slugCache } =
    useGraphContext();

  const [expanded, setExpanded] = useState<ReadonlyMap<NodeId, NeighborStatus>>(
    () => new Map(),
  );

  // Stable mutable reference so callbacks don't need `expanded` in their
  // dep array (which would change identity on every status flip).
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const updateStatus = useCallback(
    (id: NodeId, status: NeighborStatus | undefined) => {
      const next = new Map(expandedRef.current);
      if (status === undefined) {
        next.delete(id);
      } else {
        next.set(id, status);
      }
      expandedRef.current = next;
      setExpanded(next);
    },
    [],
  );

  const resolveId = useCallback(
    async (idOrSlug: string): Promise<NodeId> => {
      if (!slugResolver) return idOrSlug;
      const cached = slugCache.get(idOrSlug);
      if (cached !== undefined) return cached;
      const resolved = await slugResolver(idOrSlug);
      slugCache.set(idOrSlug, resolved);
      return resolved;
    },
    [slugResolver, slugCache],
  );

  const expand = useCallback(
    async (idOrSlug: string, depth?: number): Promise<void> => {
      if (!dataManager) return;
      let nodeId: NodeId;
      try {
        nodeId = await resolveId(idOrSlug);
      } catch (err) {
        // Slug resolution failed — log + bail.
        // eslint-disable-next-line no-console
        console.warn('[InferaGraph useInferaGraphNeighbors] slug resolve failed:', err);
        return;
      }
      updateStatus(nodeId, 'loading');
      try {
        const data = await dataManager.expandNode(nodeId, depth);

        // Touch every node we just brought in so they're freshly-MRU and
        // survive the imminent cap enforcement.
        memoryManager.touch(nodeId);
        const neighborIds = new Set<NodeId>([nodeId]);
        for (const n of data.nodes) {
          neighborIds.add(n.id);
          memoryManager.touch(n.id);
        }

        // Enforce cap with the just-expanded set protected.
        memoryManager.enforceCap(neighborIds);

        updateStatus(nodeId, 'loaded');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[InferaGraph useInferaGraphNeighbors] expand failed:', err);
        updateStatus(nodeId, 'error');
      }
    },
    [dataManager, memoryManager, resolveId, updateStatus],
  );

  const collapse = useCallback(
    async (idOrSlug: string): Promise<void> => {
      let nodeId: NodeId;
      try {
        nodeId = await resolveId(idOrSlug);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[InferaGraph useInferaGraphNeighbors] slug resolve failed:', err);
        return;
      }

      // Build the protected set. v1: only the node itself + any node that
      // was the target of an `expand` before this one (so a chain of
      // expands collapses one step at a time, not all the way back).
      const protectedIds = new Set<NodeId>([nodeId]);
      for (const id of expandedRef.current.keys()) {
        if (id === nodeId) continue;
        protectedIds.add(id);
      }

      // Identify neighbors of `nodeId` from the store's adjacency. Drop
      // any that aren't protected. We don't have a direct "did expand
      // bring this node in?" signal, but the LRU bookkeeping is enough:
      // protected nodes (other expanded foci) keep their neighbors alive
      // by virtue of being touched on their own expand call.
      const node = store.getNode(nodeId);
      if (!node) {
        // Node already gone — nothing to collapse.
        updateStatus(nodeId, undefined);
        return;
      }
      const neighborIds = store.getNeighborIds(nodeId);
      for (const id of neighborIds) {
        if (protectedIds.has(id)) continue;
        // Also skip nodes touched recently — the LRU timestamps are the
        // source of truth for "is this node still in active use?".
        // Without consulting LRU we'd over-collapse; consulting it is a
        // soft check (we still drop nodes the user never interacted with).
        const ts = memoryManager.timestamps.get(id);
        if (ts === undefined) {
          // Never touched — safe to drop.
          store.removeNode(id);
          memoryManager.forget(id);
        }
      }

      // The focus node itself stays — collapse undoes only the spread,
      // not the click-target. Clear the per-node lifecycle entry so the
      // host can re-expand cleanly later.
      updateStatus(nodeId, undefined);
    },
    [store, memoryManager, resolveId, updateStatus],
  );

  return { expand, collapse, expanded };
}

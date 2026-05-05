import type { NodeId } from '../types.js';

/**
 * Minimal slice of the {@link GraphStore} surface that {@link MemoryManager}
 * needs. Kept narrow so tests can stub a fake store with the four methods.
 */
export interface MemoryManagedStore {
  removeNode(id: NodeId): void;
  hasNode(id: NodeId): boolean;
  readonly nodeCount: number;
  /**
   * Enumerate every NodeId currently in the store. Used when picking the
   * eviction victim — untouched nodes (loaded via `getInitialView` but
   * never interacted with) need to surface in the LRU candidate pool with
   * an implicit "oldest of all" timestamp, otherwise they'd live forever.
   */
  getAllNodes(): Array<{ id: NodeId } | { readonly id: NodeId }>;
}

/**
 * Optional AI-side cleanup hooks. {@link AIEngine} implements both; tests can
 * pass `undefined` (or a partial object) when no AI surface is active.
 */
export interface MemoryManagedAIEngine {
  /** Remove the embedding record(s) for `nodeId`. No-op when none cached. */
  dropEmbedding?: (nodeId: NodeId) => void | Promise<void>;
  /** Remove every inferred edge incident to `nodeId`. No-op when none stored. */
  dropInferredEdgesFor?: (nodeId: NodeId) => void | Promise<void>;
}

/**
 * LRU eviction coordinator. Keeps the in-memory graph footprint bounded so
 * long drilldown sessions don't grow the store unboundedly.
 *
 * Responsibilities:
 *   - Track when each node was last "touched" (hover, focus, expand,
 *     getContent). The most-recent timestamp wins so freshly-interacted
 *     nodes survive eviction.
 *   - When the store exceeds its configured cap, evict the oldest
 *     non-protected nodes until either the store is under cap or every
 *     remaining node is protected.
 *   - Coordinate cleanup across the {@link GraphStore} (node + edge
 *     removal) AND the {@link AIEngine} (embedding cache + inferred-edge
 *     overlay) so a victim doesn't leak memory in a sibling subsystem.
 *
 * Design note (per Phase 6 plan): this is a SEPARATE class, not bolted into
 * {@link GraphStore}. The store is domain-agnostic and concerns itself only
 * with structural integrity; eviction policy is a host-controlled tuning
 * decision pushed in via `<InferaGraph maxNodes>`.
 */
export class MemoryManager {
  private readonly store: MemoryManagedStore;
  private readonly aiEngine: MemoryManagedAIEngine | undefined;
  private readonly maxNodes: number | undefined;
  private readonly touchTimestamps = new Map<NodeId, number>();
  /**
   * Monotonic counter used as the timestamp source. We avoid `Date.now()` so
   * tests don't have to fake the clock — every `touch()` advances by one,
   * which is enough to define a strict ordering for LRU eviction.
   */
  private clock = 0;

  /**
   * @param store    Mergeable store whose `removeNode` is invoked on eviction.
   * @param aiEngine Optional AI engine; when supplied, the manager calls
   *                 `dropEmbedding` + `dropInferredEdgesFor` for each victim
   *                 so embeddings + inferred-edge overlay don't leak.
   * @param maxNodes Soft cap. `undefined` disables eviction entirely
   *                 (every `enforceCap` call becomes a no-op). `0` is treated
   *                 the same as `undefined` so passing `<InferaGraph maxNodes={0}>`
   *                 doesn't accidentally evict everything.
   */
  constructor(
    store: MemoryManagedStore,
    aiEngine?: MemoryManagedAIEngine,
    maxNodes?: number,
  ) {
    this.store = store;
    this.aiEngine = aiEngine;
    this.maxNodes = maxNodes && maxNodes > 0 ? maxNodes : undefined;
  }

  /**
   * Mark `nodeId` as freshly used. Subsequent calls overwrite the prior
   * timestamp — most-recent touch wins, so the node moves to the front of
   * the LRU order.
   */
  touch(nodeId: NodeId): void {
    this.touchTimestamps.set(nodeId, ++this.clock);
  }

  /**
   * Drop the LRU bookkeeping for `nodeId`. Called automatically during
   * eviction; hosts that remove nodes through other paths (manual store
   * surgery, data reset) can call this directly to keep the LRU map in
   * sync with the store.
   */
  forget(nodeId: NodeId): void {
    this.touchTimestamps.delete(nodeId);
  }

  /**
   * Read-only snapshot of the LRU bookkeeping. Exposed for tests + diagnostics.
   * Consumers MUST treat the returned map as immutable — mutations corrupt
   * the eviction order.
   */
  get timestamps(): ReadonlyMap<NodeId, number> {
    return this.touchTimestamps;
  }

  /** Configured cap, or `undefined` when disabled. */
  get cap(): number | undefined {
    return this.maxNodes;
  }

  /**
   * Enforce the configured cap by evicting oldest non-protected nodes.
   *
   * Algorithm:
   *   1. If no cap is set, return immediately.
   *   2. Build the candidate list (nodes currently in the store, not in the
   *      protected set).
   *   3. Sort candidates ascending by last-touched timestamp. Nodes that have
   *      never been touched sort first (timestamp `-Infinity`) so they're
   *      evicted before any interacted node.
   *   4. Pop the oldest candidate, remove it from the store + the AI engine,
   *      and forget its timestamp. Repeat until either the store is under
   *      cap OR no non-protected candidates remain.
   *
   * Returns the list of evicted node ids (oldest first) so callers can sync
   * downstream state (renderer mesh rebuild, etc.). When the store is already
   * under cap, returns `[]`.
   *
   * Special case: if `protectedIds.size >= maxNodes`, the function logs a
   * developer-facing console warning AND skips eviction. This protects against
   * the scenario where `expand(nodeId, depth=2)` returns more neighbors than
   * the cap allows — the just-expanded set would be evicted on the same call,
   * which is almost certainly a misconfiguration.
   */
  enforceCap(protectedIds: ReadonlySet<NodeId> = new Set()): NodeId[] {
    if (this.maxNodes === undefined) return [];
    if (this.store.nodeCount <= this.maxNodes) return [];

    if (protectedIds.size > this.maxNodes) {
      // The protected set alone overflows the cap — even if we evict
      // every non-protected node, the store will still be over cap. This
      // is almost certainly a misconfiguration (e.g. `expand(node, depth=2)`
      // returned more neighbors than the cap allows). Log + skip so the
      // host can fix the cap or the depth.
      // eslint-disable-next-line no-console
      console.warn(
        `[InferaGraph MemoryManager] Skipping eviction: protected set ` +
          `(${protectedIds.size}) > cap (${this.maxNodes}). Consider raising ` +
          `\`maxNodes\` or expanding with a smaller \`depth\`.`,
      );
      return [];
    }

    // Build candidate list with timestamps. We can't trust `touchTimestamps`
    // to mirror the store exactly (a node can be merged in but never touched
    // yet) so we walk the LRU map AND the implicit "untouched" set together.
    const evicted: NodeId[] = [];
    while (this.store.nodeCount > this.maxNodes) {
      const victim = this.pickVictim(protectedIds);
      if (!victim) break; // every remaining node is protected
      this.evictOne(victim);
      evicted.push(victim);
    }
    return evicted;
  }

  /**
   * Choose the next eviction victim — the oldest non-protected node currently
   * in the store. Returns `undefined` when no candidate exists.
   *
   * Iterates the LRU map in insertion order (which matches touch order for a
   * correctly-maintained map) and falls back to "any non-protected node not
   * in the LRU map at all" for nodes that were merged in but never touched.
   */
  private pickVictim(protectedIds: ReadonlySet<NodeId>): NodeId | undefined {
    // First pass: scan the store for any untouched node — they're
    // implicitly the oldest (timestamp `-Infinity`) and should be
    // evicted before any node the user has actually interacted with.
    // This catches the common case where `getInitialView` brings in a
    // wide initial subgraph but the user only ever interacts with a
    // small subset of it; the unused portion drains away as drilldown
    // brings new nodes in.
    for (const node of this.store.getAllNodes()) {
      const id = node.id;
      if (protectedIds.has(id)) continue;
      if (!this.touchTimestamps.has(id)) return id;
    }

    // Second pass: among touched nodes, pick the one with the lowest
    // timestamp that's still in the store and not protected.
    let oldest: NodeId | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [id, ts] of this.touchTimestamps) {
      if (protectedIds.has(id)) continue;
      if (!this.store.hasNode(id)) continue;
      if (ts < oldestTs) {
        oldestTs = ts;
        oldest = id;
      }
    }
    return oldest;
  }

  /** Remove `victim` from the store + the AI side-stores. */
  private evictOne(victim: NodeId): void {
    // Drop the AI-side state first so a store-removal-triggered exception
    // doesn't leak embeddings. We deliberately fire-and-forget the (possibly
    // async) drop calls — eviction is a soft signal, not a transactional
    // boundary, and blocking on the AI engine would slow drilldown UX.
    if (this.aiEngine?.dropEmbedding) {
      try {
        const result = this.aiEngine.dropEmbedding(victim);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {
            // Eviction failures must never break the UI.
          });
        }
      } catch {
        // Same — swallow.
      }
    }
    if (this.aiEngine?.dropInferredEdgesFor) {
      try {
        const result = this.aiEngine.dropInferredEdgesFor(victim);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // swallow
      }
    }

    this.store.removeNode(victim);
    this.touchTimestamps.delete(victim);
  }
}

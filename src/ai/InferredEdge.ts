import type { NodeId } from '../types.js';

/**
 * Which signal contributed evidence for an inferred edge.
 *
 * Phase 5 supports three sources, fused via reciprocal-rank-fusion in the
 * merger:
 * - `'graph'` — pure-graph algorithms (common neighbors, Jaccard, structural
 *   cosine, decayed transitive closure) operating on the {@link GraphStore}.
 * - `'embedding'` — cosine similarity of node embeddings (Phase 3 vectors).
 * - `'llm'` — facts extracted by a single LLM call per node, validated against
 *   the existing graph.
 *
 * Inferred edges may have any non-empty subset of these sources. The order
 * within {@link InferredEdge.sources} is canonical: `graph`, `embedding`, `llm`.
 */
export type InferredEdgeSource = 'graph' | 'embedding' | 'llm';

/**
 * A relationship the system *believes* exists between two nodes but that is
 * NOT present as an explicit edge in the {@link GraphStore}.
 *
 * Inferred edges are an *overlay* concept: they live in a parallel
 * {@link InferredEdgeStore} and never mutate the underlying GraphStore. The
 * renderer draws them dashed and dimmer than explicit edges, hidden by default.
 *
 * Domain-agnostic: `type` is an opaque string. Core does not validate it
 * against any closed enum — hosting applications choose their own vocabulary
 * (and the LLM extractor will surface verbs the schema already uses).
 *
 * The pair `(sourceId, targetId)` is treated as ORDERED by the merger — i.e.
 * `(a, b)` and `(b, a)` are distinct entries. Symmetric relationships should
 * be emitted as two edges if both directions are meaningful.
 */
export interface InferredEdge {
  readonly sourceId: NodeId;
  readonly targetId: NodeId;
  /** Opaque relationship label (e.g. `'related_to'`, `'shares_setting_with'`). */
  readonly type: string;
  /** Fused confidence in `[0, 1]`. Produced by the RRF merger. */
  readonly score: number;
  /**
   * Which sources contributed. Canonical order: `graph`, `embedding`, `llm`.
   * Always non-empty.
   */
  readonly sources: ReadonlyArray<InferredEdgeSource>;
  /**
   * Human-readable rationale. Populated only when the LLM source contributed;
   * pure graph/embedding edges leave this `undefined`.
   */
  readonly reasoning?: string;
  /**
   * Per-source bookkeeping: the rank (1-based) and raw score each contributing
   * source assigned to this pair *before* RRF. Useful for debugging and for
   * downstream UI that wants to break down "why this edge."
   */
  readonly perSource?: {
    readonly graph?: { rank: number; raw: number };
    readonly embedding?: { rank: number; raw: number };
    readonly llm?: { rank: number; raw: number };
  };
}

/**
 * Pluggable persistence for the inferred-edge overlay.
 *
 * The contract is intentionally tiny: callers mostly do bulk replace
 * ({@link InferredEdgeStore.set}) and bulk read ({@link InferredEdgeStore.getAll}).
 * Direct point lookups are O(1); per-node lookups are O(n) over the store.
 *
 * Phase 5 v1 always **replaces** on `set` — there is no incremental merge.
 * Merging (e.g. preserving stable user-visible scores across recomputes) is
 * Phase 6 territory.
 */
export interface InferredEdgeStore {
  /** Direct lookup of one ordered `(source, target)` pair. */
  get(sourceId: NodeId, targetId: NodeId): Promise<InferredEdge | undefined>;
  /** All edges incident to `nodeId`, in either direction. */
  getAllForNode(nodeId: NodeId): Promise<InferredEdge[]>;
  /**
   * Snapshot of every stored edge. Returns a fresh array each call so callers
   * can iterate without worrying about concurrent {@link InferredEdgeStore.set}.
   */
  getAll(): Promise<InferredEdge[]>;
  /**
   * Replace the entire stored set with `edges`. If the same ordered
   * `(sourceId, targetId)` appears multiple times, the LAST occurrence wins.
   */
  set(edges: ReadonlyArray<InferredEdge>): Promise<void>;
  /** Remove every entry. */
  clear(): Promise<void>;
}

/**
 * Internal `Map`-backed implementation. Kept private so the surface area is
 * exactly {@link InferredEdgeStore} — tests inspect via that public contract.
 */
class InMemoryInferredEdgeStore implements InferredEdgeStore {
  private readonly map = new Map<string, InferredEdge>();

  async get(sourceId: NodeId, targetId: NodeId): Promise<InferredEdge | undefined> {
    return this.map.get(this.compositeKey(sourceId, targetId));
  }

  async getAllForNode(nodeId: NodeId): Promise<InferredEdge[]> {
    const hits: InferredEdge[] = [];
    for (const edge of this.map.values()) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) hits.push(edge);
    }
    return hits;
  }

  async getAll(): Promise<InferredEdge[]> {
    return Array.from(this.map.values());
  }

  async set(edges: ReadonlyArray<InferredEdge>): Promise<void> {
    this.map.clear();
    for (const edge of edges) {
      this.map.set(this.compositeKey(edge.sourceId, edge.targetId), edge);
    }
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  private compositeKey(sourceId: NodeId, targetId: NodeId): string {
    // `|` is a delimiter we control. NodeIds are arbitrary strings, so we
    // escape any embedded pipes (and backslashes) to keep keys unambiguous.
    return `${escapePipe(sourceId)}|${escapePipe(targetId)}`;
  }
}

function escapePipe(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Construct an in-process {@link InferredEdgeStore}. Pass to
 * `aiEngine.setInferredEdgeStore(inMemoryInferredEdgeStore())`. Persistent
 * implementations (Cosmos, Redis, etc.) live in their own packages and
 * implement the same {@link InferredEdgeStore} contract.
 */
export function inMemoryInferredEdgeStore(): InferredEdgeStore {
  return new InMemoryInferredEdgeStore();
}

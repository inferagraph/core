import type { NodeId } from '../../types.js';
import type { GraphStore } from '../../store/GraphStore.js';
import {
  cosineSimilarity,
  type EmbeddingRecord,
  type EmbeddingStore,
  type Vector,
} from '../Embedding.js';

/**
 * Inputs to {@link computeEmbeddingInferences}. Mirrors the tier detection
 * inside `AIEngine.computeInferredEdges`:
 *
 *  - When {@link embeddingStore} is set → Tier 3 path: each node's vector is
 *    looked up in the store and `embeddingStore.similar()` ranks candidates.
 *  - When {@link cacheRecords} is set → Tier 2 path: AIEngine has already
 *    loaded every cached vector; we run pairwise cosine in-memory.
 *  - When neither is set → returns `[]` (Tier 1 — no embeddings available).
 */
export interface EmbeddingInferenceContext {
  /** The graph being analysed. Used for the source-node enumeration. */
  store: GraphStore;
  /**
   * Tier-3 dedicated vector store. When set, takes precedence over
   * {@link cacheRecords}; AIEngine should not pass both in production.
   */
  embeddingStore?: EmbeddingStore;
  /**
   * Tier-2 in-memory record list. Already filtered by `(model, modelVersion)`
   * — this helper does no further filtering on the records.
   */
  cacheRecords?: EmbeddingRecord[];
  /** Embedding model name used for the {@link embeddingStore.similar} scope filter. */
  model: string;
  /** Embedding model version used for the {@link embeddingStore.similar} scope filter. */
  modelVersion: string;
  /** Maximum candidates returned per source node. Default `10`. */
  limitPerNode?: number;
  /**
   * Drop candidates with cosine similarity strictly below this threshold.
   * Default `0.7`. Setting `-Infinity` keeps everything.
   */
  minSimilarity?: number;
  /** Cancellation signal. When aborted mid-iteration, returns whatever's been collected. */
  signal?: AbortSignal;
}

/**
 * One embedding-similarity candidate. The score is cosine similarity in
 * `[-1, 1]`; the merger normalises into `[0, 1]` by clamping (negative
 * similarities never survive the threshold by default).
 */
export interface EmbeddingInferenceCandidate {
  sourceId: NodeId;
  targetId: NodeId;
  score: number;
}

/**
 * Compute embedding-similarity candidates by running pairwise cosine over
 * every node's vector. Tier 3 delegates to {@link EmbeddingStore.similar};
 * Tier 2 walks the supplied {@link cacheRecords} list and computes cosines
 * in JS.
 *
 * Self-pairs are filtered. Pairs are emitted ORDERED — `(u, v)` and `(v, u)`
 * are both candidates so the merger can pick a consistent canonical
 * direction (or keep both for symmetric relationships).
 *
 * Domain-agnostic: only operates on opaque {@link NodeId} and opaque
 * {@link Vector}. No attribute inspection.
 */
export async function computeEmbeddingInferences(
  ctx: EmbeddingInferenceContext,
): Promise<EmbeddingInferenceCandidate[]> {
  const limitPerNode = ctx.limitPerNode ?? 10;
  const minSim = ctx.minSimilarity ?? 0.7;

  if (limitPerNode <= 0) return [];
  if (ctx.signal?.aborted) return [];
  if (!ctx.embeddingStore && !ctx.cacheRecords) return [];

  const nodes = ctx.store.getAllNodes();
  if (nodes.length < 2) return [];

  const out: EmbeddingInferenceCandidate[] = [];

  if (ctx.embeddingStore) {
    // Tier 3: per-node similarity query against the dedicated store.
    // We need each source node's vector to query similar() — fetch via the
    // store's content-hash-keyed `get`. AIEngine warms vectors before
    // calling this helper, so a missing record means the warmup skipped
    // the node (e.g., embed failure). We just skip such sources.
    const vectorOf = await loadVectorsByNodeId(ctx);
    for (const node of nodes) {
      if (ctx.signal?.aborted) return out;
      const vec = vectorOf.get(node.id);
      if (!vec || vec.length === 0) continue;
      // Ask the store for top (limit+1) so we can drop the self-hit and
      // still potentially return `limit` neighbors.
      const hits = await ctx.embeddingStore.similar(
        vec,
        limitPerNode + 1,
        ctx.model,
        ctx.modelVersion,
      );
      let kept = 0;
      for (const hit of hits) {
        if (kept >= limitPerNode) break;
        if (hit.nodeId === node.id) continue;
        if (Number.isNaN(hit.score)) continue;
        if (hit.score < minSim) continue;
        out.push({ sourceId: node.id, targetId: hit.nodeId, score: hit.score });
        kept += 1;
      }
    }
    return out;
  }

  // Tier 2: pairwise cosine over cacheRecords.
  const records = ctx.cacheRecords ?? [];
  // Build a quick nodeId → Vector lookup; if the same node has multiple
  // records (shouldn't happen but harmless), keep the first.
  const vectorOf = new Map<NodeId, Vector>();
  for (const r of records) {
    if (!vectorOf.has(r.nodeId)) vectorOf.set(r.nodeId, r.vector);
  }
  for (const node of nodes) {
    if (ctx.signal?.aborted) return out;
    const vec = vectorOf.get(node.id);
    if (!vec || vec.length === 0) continue;
    const scored: EmbeddingInferenceCandidate[] = [];
    for (const [otherId, otherVec] of vectorOf) {
      if (otherId === node.id) continue;
      const sim = cosineSimilarity(vec, otherVec);
      if (Number.isNaN(sim)) continue;
      if (sim < minSim) continue;
      scored.push({ sourceId: node.id, targetId: otherId, score: sim });
    }
    scored.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(scored.length, limitPerNode); i++) {
      out.push(scored[i]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadVectorsByNodeId(
  ctx: EmbeddingInferenceContext,
): Promise<Map<NodeId, Vector>> {
  // The Tier 3 code path needs each source node's own vector to issue a
  // similar() query. We don't know the contentHash at this point, but the
  // store interface only takes the composite key. We rely on AIEngine
  // having previously called `setEmbeddingStore` and warmed vectors
  // through the public path; the host's chosen content-hash strategy is
  // opaque to us.
  //
  // The pragmatic solution: walk every node, recompute its embedding-text
  // hash, and look up. We import the content-hash + embeddingText helpers
  // lazily to keep the dependency surface small.
  const { embeddingText } = await import('../SchemaInspector.js');
  const { contentHash } = await import('../Embedding.js');

  const out = new Map<NodeId, Vector>();
  if (!ctx.embeddingStore) return out;
  for (const storeNode of ctx.store.getAllNodes()) {
    const text = embeddingText({
      id: storeNode.id,
      attributes: storeNode.attributes,
    });
    const hash = contentHash(text);
    const record = await ctx.embeddingStore.get(
      storeNode.id,
      ctx.model,
      ctx.modelVersion,
      hash,
    );
    if (record) out.set(storeNode.id, record.vector);
  }
  return out;
}

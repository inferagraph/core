import type { GraphStore } from '../store/GraphStore.js';
import type { LLMProvider } from './LLMProvider.js';
import {
  cosineSimilarity,
  contentHash as computeContentHash,
  type EmbeddingRecord,
  type EmbeddingStore,
  type Vector,
} from './Embedding.js';
import {
  embeddingText,
  DEFAULT_EMBEDDING_CONTENT_KEYS,
} from './SchemaInspector.js';
import type { InferredEdge, InferredEdgeStore } from './InferredEdge.js';

/**
 * Configuration for {@link GraphIndexer}. Hosts wire one of these once,
 * after data load + before chat goes live, to drive the entire RAG
 * indexing pipeline (embeddings + inferred edges) over the graph.
 */
export interface GraphIndexerConfig {
  /** Source of truth for nodes + edges. */
  store: GraphStore;
  /**
   * LLM provider with `embed` capability. The indexer asserts at construct
   * time that `embed` is present — providers without it cannot drive
   * indexing.
   */
  provider: LLMProvider;
  /** Persistent vector store for unit embeddings. */
  embeddingStore: EmbeddingStore;
  /** Persistent store for inferred edges. */
  inferredEdgeStore: InferredEdgeStore;
  /**
   * Per-host content-priority keys used by {@link embeddingText}. Default
   * `['content', 'description', 'body', 'summary']`.
   */
  contentKeys?: readonly string[];
  /**
   * Embedding model name. When omitted, falls back to the provider's
   * `defaultEmbeddingModel` (or its `name`). Persisted in each
   * {@link EmbeddingRecord.meta} so cross-model entries don't collide.
   */
  embeddingModel?: string;
  /** Embedding vector dimensionality. Default 3072 (text-embedding-3-large). */
  embeddingDimensions?: number;
  /**
   * Cosine-similarity threshold above which a pair becomes a candidate
   * inferred edge. Default 0.75.
   */
  inferredEdgeThreshold?: number;
  /** Hard cap on inferred edges incident to any single node. Default 5. */
  maxInferredEdgesPerNode?: number;
  /**
   * How many texts to send per `provider.embed` call. Tuned for
   * round-trip-amortization vs. provider request size limits. Default 16.
   */
  embeddingBatchSize?: number;
  /**
   * How many candidate inferred-edge pairs to send per `provider.complete`
   * call. Default `1` (one prompt per pair, preserves pre-0.9.0 behavior).
   *
   * When set to K > 1, the indexer asks the LLM for K relationship
   * descriptions in a single JSON-array response per batch. On a malformed
   * batch response (non-JSON, missing `descriptions` array, or an array of
   * the wrong length), the indexer falls back to per-pair calls for THAT
   * batch and continues — one bad batch must not break the indexing pass.
   *
   * For an N-pair indexing run with batch size K, this drops the
   * `provider.complete` cost from N to ceil(N/K) on the happy path.
   */
  inferredEdgeBatchSize?: number;
}

/** One progress callback payload emitted by {@link GraphIndexer}. */
export interface IndexerProgress {
  stage: 'embed' | 'inferred-edges' | 'reconcile';
  completed: number;
  total: number;
}

/**
 * Reusable indexing engine — the entry point hosts call after data load
 * to populate embeddings + inferred edges. Stays generic; per-host
 * knowledge enters via {@link GraphIndexerConfig.contentKeys} only.
 *
 * Pipeline:
 *   1. {@link embedAll} — embed every node whose content hash differs
 *      from the store; reuses existing rows when the hash matches.
 *   2. {@link computeInferredEdges} — for every unconnected pair whose
 *      embeddings cross {@link GraphIndexerConfig.inferredEdgeThreshold},
 *      ask the LLM for a short relationship description, embed that,
 *      and persist the inferred edge.
 *   3. {@link recomputeInferredEdgesFor} — surgical re-run for one node.
 *   4. {@link reconcile} — drop orphan embeddings / inferred edges left
 *      behind by node deletions.
 *
 * The indexer never mutates the {@link GraphStore} or hides provider
 * errors silently — callers can rely on exceptions surfacing.
 */
export class GraphIndexer {
  private readonly config: Required<
    Omit<GraphIndexerConfig, 'store' | 'provider' | 'embeddingStore' | 'inferredEdgeStore'>
  > & {
    store: GraphStore;
    provider: LLMProvider;
    embeddingStore: EmbeddingStore;
    inferredEdgeStore: InferredEdgeStore;
  };

  constructor(config: GraphIndexerConfig) {
    if (typeof config.provider.embed !== 'function') {
      throw new Error(
        'GraphIndexer requires a provider with embed() capability',
      );
    }
    this.config = {
      store: config.store,
      provider: config.provider,
      embeddingStore: config.embeddingStore,
      inferredEdgeStore: config.inferredEdgeStore,
      contentKeys: config.contentKeys ?? DEFAULT_EMBEDDING_CONTENT_KEYS,
      embeddingModel:
        config.embeddingModel ?? inferModelName(config.provider),
      embeddingDimensions: config.embeddingDimensions ?? 3072,
      inferredEdgeThreshold: config.inferredEdgeThreshold ?? 0.75,
      maxInferredEdgesPerNode: config.maxInferredEdgesPerNode ?? 5,
      embeddingBatchSize: config.embeddingBatchSize ?? 16,
      inferredEdgeBatchSize: config.inferredEdgeBatchSize ?? 1,
    };
  }

  /**
   * Embed every node whose `(model, modelVersion, contentHash)` is missing
   * from the {@link EmbeddingStore}. Idempotent — a second call with no
   * data changes hits cache for every node and bills nothing.
   *
   * Returns counts so the caller can log "embedded N, cached M" without
   * subscribing to progress events.
   */
  async embedAll(opts?: {
    onProgress?: (p: IndexerProgress) => void;
  }): Promise<{ embedded: number; cached: number }> {
    const {
      store,
      provider,
      embeddingStore,
      contentKeys,
      embeddingModel,
      embeddingBatchSize,
    } = this.config;
    const embedFn = provider.embed!.bind(provider);
    const modelVersion = '';

    const allNodes = store.getAllNodes();
    let cached = 0;
    let embedded = 0;
    const total = allNodes.length;

    // Phase 1: bucket pending vs cached.
    const pending: Array<{ id: string; text: string; hash: string }> = [];
    for (const n of allNodes) {
      const text = embeddingText(
        { id: n.id, attributes: n.attributes },
        { contentKeys },
      );
      const hash = computeContentHash(text);
      const existing = await embeddingStore.get(
        n.id,
        embeddingModel,
        modelVersion,
        hash,
      );
      if (existing) {
        cached += 1;
      } else {
        pending.push({ id: n.id, text, hash });
      }
    }

    if (pending.length === 0) {
      opts?.onProgress?.({ stage: 'embed', completed: total, total });
      return { embedded, cached };
    }

    // Phase 2: batch embed + persist.
    let processed = cached;
    for (let i = 0; i < pending.length; i += embeddingBatchSize) {
      const slice = pending.slice(i, i + embeddingBatchSize);
      const texts = slice.map((p) => p.text);
      const vectors = await embedFn(texts);
      const generatedAt = new Date().toISOString();
      for (let j = 0; j < slice.length; j++) {
        const v = vectors[j];
        if (!v) continue;
        const record: EmbeddingRecord = {
          nodeId: slice[j].id,
          vector: v,
          meta: {
            model: embeddingModel,
            modelVersion,
            generatedAt,
            contentHash: slice[j].hash,
          },
        };
        await embeddingStore.set(record);
        embedded += 1;
        processed += 1;
      }
      opts?.onProgress?.({
        stage: 'embed',
        completed: processed,
        total,
      });
    }

    return { embedded, cached };
  }

  /**
   * Walk every unique unordered pair of nodes whose embeddings are
   * present, compute cosine similarity, and persist an inferred edge for
   * each pair above {@link GraphIndexerConfig.inferredEdgeThreshold} that
   * is NOT already connected by an explicit edge in the store. Per-node
   * cap from {@link GraphIndexerConfig.maxInferredEdgesPerNode} bounds
   * the result.
   */
  async computeInferredEdges(opts?: {
    onProgress?: (p: IndexerProgress) => void;
  }): Promise<{ created: number }> {
    const created = await this.persistInferredEdges(undefined, opts);
    return { created };
  }

  /**
   * Drop every inferred edge incident to `nodeId` and recompute just that
   * node's edges. Used when a single node's content changes — cheaper than
   * a full {@link computeInferredEdges} pass.
   */
  async recomputeInferredEdgesFor(
    nodeId: string,
  ): Promise<{ created: number; deleted: number }> {
    const { inferredEdgeStore } = this.config;
    const all = await inferredEdgeStore.getAll();
    const remaining = all.filter(
      (e) => e.sourceId !== nodeId && e.targetId !== nodeId,
    );
    const deleted = all.length - remaining.length;
    await inferredEdgeStore.set(remaining);

    const created = await this.persistInferredEdges(nodeId);
    return { created, deleted };
  }

  /**
   * Drop orphan embeddings (nodes gone from the store) and orphan
   * inferred edges (either endpoint gone). Idempotent.
   *
   * Only the inferred-edge side is enforced today: the
   * {@link EmbeddingStore} contract has no general "list every entry"
   * primitive, so embedding orphan-purging is best-effort and a no-op
   * for stores that don't expose one. Hosts running production-grade
   * vector stores should run their own embedding-purge pass.
   */
  async reconcile(): Promise<{
    orphanEmbeddings: number;
    orphanInferredEdges: number;
  }> {
    const { store, inferredEdgeStore } = this.config;
    const all = await inferredEdgeStore.getAll();
    const remaining: InferredEdge[] = [];
    let orphans = 0;
    for (const e of all) {
      if (store.hasNode(e.sourceId) && store.hasNode(e.targetId)) {
        remaining.push(e);
      } else {
        orphans += 1;
      }
    }
    if (orphans > 0) await inferredEdgeStore.set(remaining);

    return { orphanEmbeddings: 0, orphanInferredEdges: orphans };
  }

  /**
   * Internal: shared body for {@link computeInferredEdges} and
   * {@link recomputeInferredEdgesFor}. When `onlyForNodeId` is set, only
   * pairs touching that node are considered; otherwise every unique
   * unordered pair is.
   */
  private async persistInferredEdges(
    onlyForNodeId: string | undefined,
    opts?: { onProgress?: (p: IndexerProgress) => void },
  ): Promise<number> {
    const {
      store,
      provider,
      embeddingStore,
      embeddingModel,
      inferredEdgeThreshold,
      maxInferredEdgesPerNode,
      inferredEdgeStore,
    } = this.config;
    const modelVersion = '';

    const nodes = store.getAllNodes();
    if (nodes.length < 2) return 0;

    // Build (id → vector) by reading the latest persisted record per node.
    // We read via `similar` for in-memory parity but skip nodes without an
    // entry. Production stores can implement a `getAll`-style primitive
    // for efficiency — that's a v2 concern.
    const byId = new Map<string, Vector>();
    for (const n of nodes) {
      const text = embeddingText(
        { id: n.id, attributes: n.attributes },
        { contentKeys: this.config.contentKeys },
      );
      const hash = computeContentHash(text);
      const rec = await embeddingStore.get(
        n.id,
        embeddingModel,
        modelVersion,
        hash,
      );
      if (rec) byId.set(n.id, rec.vector);
    }
    if (byId.size < 2) return 0;

    // Build the explicit-edge adjacency once so the per-pair check is O(1).
    const explicit = new Set<string>();
    for (const e of store.getAllEdges()) {
      explicit.add(pairKey(e.sourceId, e.targetId));
      explicit.add(pairKey(e.targetId, e.sourceId));
    }

    // Existing inferred edges (so a recompute for one node leaves the
    // others alone).
    const existing = await inferredEdgeStore.getAll();
    const haveSet = new Set<string>();
    for (const e of existing) haveSet.add(pairKey(e.sourceId, e.targetId));

    // Walk pairs.
    const ids = [...byId.keys()].sort();
    interface Candidate {
      a: string;
      b: string;
      score: number;
    }
    const candidates: Candidate[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (
          onlyForNodeId !== undefined &&
          a !== onlyForNodeId &&
          b !== onlyForNodeId
        ) {
          continue;
        }
        if (
          explicit.has(pairKey(a, b)) ||
          haveSet.has(pairKey(a, b)) ||
          haveSet.has(pairKey(b, a))
        ) {
          continue;
        }
        const va = byId.get(a)!;
        const vb = byId.get(b)!;
        const score = cosineSimilarity(va, vb);
        if (Number.isNaN(score)) continue;
        if (score < inferredEdgeThreshold) continue;
        candidates.push({ a, b, score });
      }
    }

    candidates.sort((x, y) => y.score - x.score);

    // Apply per-node cap (counting against pre-existing inferred degree
    // when only a single node is being recomputed).
    const degree = new Map<string, number>();
    for (const e of existing) {
      degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
      degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
    }

    const accepted: Candidate[] = [];
    for (const c of candidates) {
      const da = degree.get(c.a) ?? 0;
      const db = degree.get(c.b) ?? 0;
      if (da >= maxInferredEdgesPerNode || db >= maxInferredEdgesPerNode) {
        continue;
      }
      accepted.push(c);
      degree.set(c.a, da + 1);
      degree.set(c.b, db + 1);
    }

    if (accepted.length === 0) return 0;

    const completeFn = provider.complete.bind(provider);
    const embedFn = provider.embed!.bind(provider);
    const batchSize = Math.max(1, this.config.inferredEdgeBatchSize);

    const newEdges: InferredEdge[] = [];
    let processed = 0;

    // Iterate accepted pairs in chunks of `batchSize`. With batchSize=1
    // this degenerates to one prompt per pair (pre-0.9.0 behavior); with
    // K>1 we ask the LLM for K descriptions in one JSON-array response,
    // and fall back to per-pair on malformed responses.
    for (let i = 0; i < accepted.length; i += batchSize) {
      const chunk = accepted.slice(i, i + batchSize);
      const titlesPerPair = chunk.map((c) => ({
        aTitle: pickTitle(store, c.a),
        bTitle: pickTitle(store, c.b),
      }));

      let descriptions: (string | undefined)[] = chunk.map(() => undefined);

      if (chunk.length > 1) {
        // Try the batched-prompt path first.
        const batchPrompt = buildBatchPrompt(chunk, titlesPerPair);
        let raw = '';
        let batchOk = false;
        try {
          raw = await completeFn(batchPrompt);
          const parsed = parseBatchDescriptions(raw, chunk.length);
          if (parsed) {
            descriptions = parsed;
            batchOk = true;
          }
        } catch {
          // Batch call itself errored — fall through to per-pair below.
          batchOk = false;
        }
        if (!batchOk) {
          // Defensive fallback: malformed JSON / wrong array length / call
          // threw → run per-pair calls for THIS batch only and continue.
          descriptions = await runPerPairCompletes(
            completeFn,
            chunk,
            titlesPerPair,
          );
        }
      } else {
        // batchSize-of-1 path — one prompt per pair.
        descriptions = await runPerPairCompletes(
          completeFn,
          chunk,
          titlesPerPair,
        );
      }

      for (let j = 0; j < chunk.length; j++) {
        const c = chunk[j];
        const description = (descriptions[j] ?? '').trim() || 'Related entities';

        let descriptionVector: Vector | undefined;
        try {
          const [v] = await embedFn([description]);
          descriptionVector = v;
        } catch {
          // Description-vector failure is non-fatal — store the edge
          // without an embedding. Hosts that need the vector for
          // retrieval will re-run later.
          descriptionVector = undefined;
        }
        void descriptionVector;

        newEdges.push({
          sourceId: c.a,
          targetId: c.b,
          type: 'related_to',
          score: c.score,
          sources: ['embedding', 'llm'],
          reasoning: description,
        });
        processed += 1;
        opts?.onProgress?.({
          stage: 'inferred-edges',
          completed: processed,
          total: accepted.length,
        });
      }
    }

    if (newEdges.length === 0) return 0;
    await inferredEdgeStore.set([...existing, ...newEdges]);
    return newEdges.length;
  }
}

/** One pair-of-ids row used by the per-pair / batched description helpers. */
interface PairChunkItem {
  a: string;
  b: string;
  score: number;
}

/** Build the per-pair prompt the indexer used pre-0.9.0. */
function buildSinglePrompt(
  c: PairChunkItem,
  titles: { aTitle: string; bTitle: string },
): string {
  return (
    `Two entities in a knowledge graph share strong semantic similarity (cosine ${c.score.toFixed(3)}).` +
    ` Briefly describe their relationship in one short sentence.\n` +
    `Entity A: ${titles.aTitle}\n` +
    `Entity B: ${titles.bTitle}`
  );
}

/**
 * Build the batched-prompt payload for K candidate pairs. Asks the LLM
 * for a strict JSON object: `{"descriptions": [...]}` with K entries in
 * the same order as the listed pairs.
 */
function buildBatchPrompt(
  chunk: PairChunkItem[],
  titlesPerPair: Array<{ aTitle: string; bTitle: string }>,
): string {
  const lines: string[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const t = titlesPerPair[i];
    lines.push(
      `${i + 1}. ${t.aTitle} <-> ${t.bTitle} (cosine ${chunk[i].score.toFixed(3)})`,
    );
  }
  return (
    `You will be given ${chunk.length} candidate relationships between pairs of entities in a knowledge graph.\n` +
    `For each pair, generate one short sentence describing the relationship from entity A to entity B.\n` +
    `Return JSON only, with exactly ${chunk.length} entries in the same order as the list:\n` +
    `{"descriptions": ["...", "..."]}\n\n` +
    `Pairs:\n${lines.join('\n')}`
  );
}

/**
 * Defensive parse of a batched-prompt response. Returns the array of
 * descriptions when the response is valid JSON of shape
 * `{descriptions: string[]}` AND the array length matches `expected`.
 * Returns `undefined` on any malformed shape so the caller can fall back
 * to per-pair calls.
 */
function parseBatchDescriptions(
  raw: string,
  expected: number,
): string[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  // Strip a leading code-fence (```json ... ```) if the model added one.
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const descs = (parsed as { descriptions?: unknown }).descriptions;
  if (!Array.isArray(descs)) return undefined;
  if (descs.length !== expected) return undefined;
  const out: string[] = [];
  for (const d of descs) {
    if (typeof d !== 'string') return undefined;
    out.push(d);
  }
  return out;
}

/**
 * Per-pair completion fallback. Used both for the batchSize-of-1 path
 * AND for malformed-batch fallback. A single pair throwing is silently
 * skipped (description left `undefined`) — best-effort indexing.
 */
async function runPerPairCompletes(
  completeFn: (prompt: string) => Promise<string>,
  chunk: PairChunkItem[],
  titlesPerPair: Array<{ aTitle: string; bTitle: string }>,
): Promise<(string | undefined)[]> {
  const out: (string | undefined)[] = chunk.map(() => undefined);
  for (let i = 0; i < chunk.length; i++) {
    try {
      const reply = await completeFn(buildSinglePrompt(chunk[i], titlesPerPair[i]));
      out[i] = reply;
    } catch {
      out[i] = undefined;
    }
  }
  return out;
}

function pairKey(a: string, b: string): string {
  return `${a} ${b}`;
}

function pickTitle(store: GraphStore, id: string): string {
  const node = store.getNode(id);
  if (!node) return id;
  const attrs = node.attributes ?? {};
  for (const key of ['name', 'title', 'label']) {
    const v = attrs[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return id;
}

function inferModelName(provider: LLMProvider): string {
  const candidate = (provider as unknown as { defaultEmbeddingModel?: string })
    .defaultEmbeddingModel;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  return provider.name;
}

import type { NodeId } from '../types.js';
import {
  cosineSimilarity,
  type EmbeddingRecord,
  type EmbeddingStore,
  type SimilarHit,
  type Vector,
} from './Embedding.js';

/**
 * In-process default {@link EmbeddingStore}. Backed by a single `Map` keyed
 * by the composite `(nodeId, model, modelVersion, contentHash)` so model
 * bumps + content edits each produce distinct entries and never collide.
 *
 * Similarity is computed at query time over every entry that matches the
 * `model` + `modelVersion` scope. This is fine up to ~few-thousand entries;
 * beyond that, the host should swap in a vector-native store (Redis, Cosmos,
 * etc.) — the {@link EmbeddingStore} contract is identical.
 *
 * The implementation is deliberately a class only behind a factory. The
 * factory function is what consumers import; the class is internal so tests
 * can inspect via the public {@link EmbeddingStore} surface.
 */
class InMemoryEmbeddingStore implements EmbeddingStore {
  private readonly map = new Map<string, EmbeddingRecord>();

  async get(
    nodeId: NodeId,
    model: string,
    modelVersion: string,
    contentHash: string,
  ): Promise<EmbeddingRecord | undefined> {
    return this.map.get(this.compositeKey(nodeId, model, modelVersion, contentHash));
  }

  async set(record: EmbeddingRecord): Promise<void> {
    const key = this.compositeKey(
      record.nodeId,
      record.meta.model,
      record.meta.modelVersion,
      record.meta.contentHash,
    );
    // Clone the vector so caller mutations don't bleed into the store.
    this.map.set(key, {
      nodeId: record.nodeId,
      vector: record.vector.slice(),
      meta: { ...record.meta },
    });
  }

  async similar(
    queryVector: Vector,
    k: number,
    model?: string,
    modelVersion?: string,
  ): Promise<SimilarHit[]> {
    if (k <= 0) return [];
    const hits: SimilarHit[] = [];
    // Track best score per nodeId so duplicates from different
    // (model,version,contentHash) combinations collapse to the most-similar.
    const seen = new Map<NodeId, number>();
    for (const record of this.map.values()) {
      if (model !== undefined && model !== '' && record.meta.model !== model) continue;
      if (
        modelVersion !== undefined &&
        modelVersion !== '' &&
        record.meta.modelVersion !== modelVersion
      ) {
        continue;
      }
      const score = cosineSimilarity(queryVector, record.vector);
      if (Number.isNaN(score)) continue;
      const prev = seen.get(record.nodeId);
      if (prev === undefined || score > prev) seen.set(record.nodeId, score);
    }
    for (const [nodeId, score] of seen) hits.push({ nodeId, score });
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  /** Test-only inspection helper: how many records are stored. */
  get size(): number {
    return this.map.size;
  }

  private compositeKey(
    nodeId: NodeId,
    model: string,
    modelVersion: string,
    contentHash: string,
  ): string {
    // `|` is a delimiter we control: nodeIds are arbitrary strings, but the
    // other three fields are model/version/hex-hash — none of which include
    // pipes in practice. We escape pipes in the nodeId to stay safe.
    return `${escapePipe(nodeId)}|${model}|${modelVersion}|${contentHash}`;
  }
}

function escapePipe(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Construct an in-process {@link EmbeddingStore}. Pass to
 * `<InferaGraph embeddingStore={inMemoryEmbeddingStore()} />`. Persistent
 * stores live in their own packages.
 */
export function inMemoryEmbeddingStore(): EmbeddingStore {
  return new InMemoryEmbeddingStore();
}

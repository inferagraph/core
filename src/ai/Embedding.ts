/**
 * Phase 3 — embeddings + vector storage primitives.
 *
 * The shapes here are shared with provider packages
 * (`@inferagraph/openai-provider`, `@inferagraph/anthropic-provider`) and with
 * persistent {@link EmbeddingStore} implementations that may live in their own
 * packages later. Treat this module as a public contract: changes here are
 * breaking changes for every provider and store.
 */

import type { NodeId } from '../types.js';

/**
 * A dense embedding vector. Always a plain JS `number[]` for portability —
 * Float32Array/Typed-array adapters are an implementation detail of stores
 * that want them. Length is provider/model dependent.
 */
export type Vector = number[];

/**
 * Per-call options accepted by {@link LLMProvider.embed}. Providers may
 * ignore unsupported fields. Defaults are deliberately left to the provider
 * so the host doesn't have to know which model is in use.
 */
export interface EmbedOptions {
  /**
   * Override the provider's default embedding model. Each provider documents
   * the models it accepts. When omitted, the provider picks its own default
   * (e.g. `text-embedding-3-small` for OpenAI, `voyage-3.5` for Voyage).
   */
  model?: string;
  /** Optional cancellation signal. Providers that don't honor signals fall back to ignoring it. */
  signal?: AbortSignal;
}

/**
 * Provenance metadata persisted with every embedding record.
 *
 * `model` + `modelVersion` together identify which embedding model produced
 * the vector (the provider documents how it splits these — e.g. OpenAI uses
 * the model id as both, Voyage breaks them apart). `contentHash` lets us
 * cache-bust on data edits without re-running every node through the model.
 * `generatedAt` is an ISO-8601 timestamp captured at embed time.
 */
export interface EmbeddingMeta {
  /** Logical model name. e.g. `'text-embedding-3-small'` or `'voyage-3.5'`. */
  model: string;
  /**
   * Optional model version string. Providers without versioned model ids
   * (most modern ones treat the model name as the version) leave this empty.
   * The cache-key MUST include this so a model bump invalidates entries.
   */
  modelVersion: string;
  /** ISO-8601 timestamp of the embed() call that produced this vector. */
  generatedAt: string;
  /**
   * Stable hash of the source text. Changes here mean the underlying node's
   * embedding text changed (attribute edit, title rename, etc.) and the
   * vector must be regenerated. See {@link contentHash} for the canonical
   * implementation used by the engine.
   */
  contentHash: string;
}

/**
 * One persisted embedding. Stored by {@link EmbeddingStore} implementations
 * keyed by `(nodeId, model, modelVersion, contentHash)` so model changes,
 * version bumps, AND data edits all yield distinct entries (no stale hits).
 */
export interface EmbeddingRecord {
  nodeId: NodeId;
  vector: Vector;
  meta: EmbeddingMeta;
}

/**
 * A single semantic-similarity hit returned by {@link EmbeddingStore.similar}.
 * Shape mirrors the AI {@link SearchResult} so AIEngine.search can return them
 * directly without re-shaping.
 */
export interface SimilarHit {
  nodeId: NodeId;
  /**
   * Similarity score in [-1, 1]. Higher = more similar. Stores SHOULD return
   * cosine similarity; consumers ranking across stores must not assume any
   * specific scale beyond "higher is better".
   */
  score: number;
}

/**
 * Pluggable vector storage for `@inferagraph/core`.
 *
 * Tier 3 of the embedding storage progression: hosts pass an instance to
 * `<InferaGraph embeddingStore={...} />`. The default in-process
 * implementation (see {@link inMemoryEmbeddingStore}) ships with this package;
 * persistent implementations (Redis vector, Cosmos vector, etc.) come as
 * separate packages.
 *
 * The shape is deliberately tiny: `get` / `set` / `similar` / `clear`. That's
 * enough for the AI engine's needs and lets external implementations target
 * a stable contract.
 */
export interface EmbeddingStore {
  /**
   * Look up a record for `(nodeId, model, modelVersion, contentHash)`.
   * Returns `undefined` when nothing matches.
   *
   * The composite key is intentional: an entry only "hits" when ALL four
   * components match, so model bumps, version bumps, and content edits each
   * naturally bypass stale data without explicit invalidation.
   */
  get(
    nodeId: NodeId,
    model: string,
    modelVersion: string,
    contentHash: string,
  ): Promise<EmbeddingRecord | undefined>;
  /** Persist a record. Implementations must overwrite any existing entry with the same composite key. */
  set(record: EmbeddingRecord): Promise<void>;
  /**
   * Vector-native similarity search. Implementations may use whatever index
   * makes sense (flat, HNSW, etc.). `k` is the maximum number of hits to
   * return — fewer is fine when the store has fewer entries.
   *
   * `model` + `modelVersion` are SCOPE filters: stores must only consider
   * entries whose embedding model + version match, since cross-model
   * similarity is not meaningful. Passing the empty string matches "any".
   */
  similar(
    queryVector: Vector,
    k: number,
    model?: string,
    modelVersion?: string,
  ): Promise<SimilarHit[]>;
  /** Drop everything. */
  clear(): Promise<void>;
}

/**
 * Compute cosine similarity between two vectors. Returns 0 when either
 * vector is zero-length. Length mismatch returns `NaN` so callers can detect
 * and skip; we deliberately don't throw because mismatched lengths in a real
 * deployment usually mean a model upgrade landed mid-flight, and a hard
 * throw would break the entire search.
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return NaN;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Stable 16-char hex hash of a string, used as `EmbeddingMeta.contentHash`.
 *
 * Implemented as 64-bit FNV-1a (two 32-bit halves, no BigInt) so the bundle
 * works in browsers + edge runtimes without polyfills. Collision-resistant
 * enough for our cache-busting purpose (a collision merely reuses a stale
 * vector, which the next data edit will overwrite).
 */
export function contentHash(input: string): string {
  let hi = 0xcbf29ce4 | 0;
  let lo = 0x84222325 | 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    lo = (lo ^ code) >>> 0;
    const PRIME_HI = 0x100;
    const PRIME_LO = 0x000001b3;
    const loMul = Math.imul(lo, PRIME_LO);
    const hiMul = Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI);
    lo = loMul >>> 0;
    hi = (hiMul + ((loMul / 0x100000000) | 0)) >>> 0;
  }
  return ((hi >>> 0).toString(16).padStart(8, '0')) + ((lo >>> 0).toString(16).padStart(8, '0'));
}

import type { NodeData } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import type { CacheProvider } from '../cache/lruCache.js';
import { SearchEngine } from '../store/SearchEngine.js';
import type {
  CompleteOptions,
  LLMProvider,
  LLMStreamEvent,
  LLMToolDefinition,
} from './LLMProvider.js';
import type { ChatEvent, ChatOptions, FilterSpec } from './ChatEvent.js';
import {
  contentHash as computeContentHash,
  cosineSimilarity,
  type EmbeddingRecord,
  type EmbeddingStore,
  type Vector,
} from './Embedding.js';
import { SchemaInspector, embeddingText } from './SchemaInspector.js';
import type { SearchResult } from './SearchResult.js';
import type {
  InferredEdge,
  InferredEdgeSource,
  InferredEdgeStore,
} from './InferredEdge.js';
import { computeGraphInferences } from './inference/graph.js';
import { computeEmbeddingInferences } from './inference/embedding.js';
import { computeLLMInferences } from './inference/llm.js';
import { mergeInferences } from './inference/merge.js';

/**
 * Tunables for the AI engine. Phase 1 deliberately keeps this small — chat,
 * search, highlight, embeddings, drilldown all land in later phases.
 */
export interface AIEngineConfig {
  /**
   * Maximum number of distinct values to include per attribute when describing
   * the dataset schema to the LLM. Keeps token usage bounded on large graphs.
   * Default: 10.
   */
  schemaSampleSize?: number;
  /**
   * Default `k` for {@link AIEngine.search}. Default: 25.
   * Per-call `opts.k` always wins.
   */
  defaultSearchK?: number;
}

/** Internal: which embedding storage path is currently active. */
type EmbeddingTier = 'tier-1' | 'tier-2' | 'tier-3';

/** Options for {@link AIEngine.computeInferredEdges}. */
export interface ComputeInferredEdgesOptions {
  /**
   * Which inference sources to run. Default: all three (`graph`, `embedding`,
   * `llm`). Sources that have no underlying capability (e.g. `llm` without a
   * provider) are skipped silently regardless of the list.
   */
  sources?: ReadonlyArray<InferredEdgeSource>;
  /** Maximum candidate edges produced per source node, per signal. Default `5`. */
  limitPerNode?: number;
  /**
   * When `true` (default + recommended), drop merged candidates whose pair
   * already exists as an explicit edge in the {@link GraphStore} (in either
   * direction). The keystone setting — disabling it produces ~80% noise.
   */
  excludeExplicit?: boolean;
  /** Cancellation signal. When aborted mid-compute, the call returns without writing. */
  signal?: AbortSignal;
}

/**
 * Locked built-in tool definitions. The same names + parameter shapes are
 * used by the prompt builder, the JSON-Schema sent to the LLM provider,
 * the cache-key hash, and the chat-event parser. Changing this list
 * requires provider-package coordination.
 *
 * Phase 2 introduced `apply_filter`, `highlight`, `focus`, `annotate`.
 * Phase 5 added `set_inferred_visibility`.
 */
const BUILT_IN_TOOLS: LLMToolDefinition[] = [
  {
    name: 'apply_filter',
    description:
      'Restrict which nodes are visible. Pass a domain-agnostic filter spec keyed by node attribute names. A node matches when, for EVERY key in the spec, the node\'s attribute value (or any element of an array attribute) is one of the listed strings.',
    parameters: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          description:
            'Filter spec: keys are node attribute names; values are arrays of allowed string values. Use only attribute names that appear in the schema.',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      required: ['spec'],
    },
  },
  {
    name: 'highlight',
    description:
      'Emphasize a set of nodes. Non-highlighted nodes dim. Pass an empty list to clear highlight.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node ids to highlight.',
        },
      },
      required: ['ids'],
    },
  },
  {
    name: 'focus',
    description: 'Animate the camera to focus on a single node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Id of the node to focus on.',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'annotate',
    description:
      'Attach a callout / sticky note to a node with host-supplied prose.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Id of the node to annotate.',
        },
        text: {
          type: 'string',
          description: 'Plain text annotation. Host renders the styling.',
        },
      },
      required: ['nodeId', 'text'],
    },
  },
  {
    name: 'set_inferred_visibility',
    description:
      'Show or hide the inferred-relationship overlay (dashed edges between nodes the system thinks are related).',
    parameters: {
      type: 'object',
      properties: {
        visible: {
          type: 'boolean',
          description: 'true to show inferred edges, false to hide.',
        },
      },
      required: ['visible'],
    },
  },
];

/** Cached chat replay, keyed by `chatCacheKey`. */
interface CachedChatReplay {
  events: LLMStreamEvent[];
}

/**
 * The InferaGraph AI engine. Owns the LLM provider + (optional) response cache
 * and exposes high-level operations the React layer routes user actions through.
 *
 * Phase 1 surface:
 *   - `setProvider` / `setCache` — wired by the `<InferaGraph llm cache>` props.
 *   - `compileFilter(nlq)` — natural-language query → predicate the renderer accepts.
 *
 * Phase 2 surface:
 *   - `chat(message, opts)` — streaming chat with tool calls. Yields a host-
 *     facing iterable of {@link ChatEvent}s; the React layer dispatches
 *     tool-call events to the renderer's `setHighlight` / `focusOn` /
 *     `annotate` / `setFilter` methods.
 *
 * The engine is host-blind by contract: hosts never invoke it directly. The
 * React layer pushes provider/cache/query into it; chat events flow back out
 * through the iterable returned by `chat()`.
 */
export class AIEngine {
  private readonly store: GraphStore;
  private readonly schemaSampleSize: number;
  private readonly defaultSearchK: number;
  private readonly inspector: SchemaInspector;
  private readonly keywordEngine: SearchEngine;
  private provider: LLMProvider | undefined;
  private cache: CacheProvider | undefined;
  private embeddingStore: EmbeddingStore | undefined;
  private inferredEdgeStore: InferredEdgeStore | undefined;
  /**
   * Reference identity of the last provider seen by any cached operation.
   * Per the user's design choice, switching the provider instance triggers a
   * `cache.clear()` so responses from the prior model don't bleed across.
   */
  private lastProvider: LLMProvider | undefined;
  /**
   * Most-recent embedding warmup promise. `undefined` until the first
   * call to {@link ensureEmbeddings}; non-`undefined` while warmup is
   * either in-flight or settled. Re-used by all callers within a single
   * "data version" so concurrent searches never trigger duplicate batch
   * embeds.
   */
  private warmupPromise: Promise<void> | undefined;
  /**
   * Hash of the (provider-name, store-snapshot) signature that the current
   * warmup was issued against. When the snapshot changes (data edit, provider
   * swap, etc.) we drop {@link warmupPromise} on next ensure call.
   */
  private warmupSignature: string | undefined;
  /**
   * Monotonic token issued at the start of each {@link computeInferredEdges}
   * call. Mid-flight checks compare the captured token against this field;
   * a mismatch means a newer compute superseded the in-flight one, so the
   * old call bails before persisting. Mirrors the Phase 5 pattern used by
   * {@link ensureEmbeddings} to avoid stale writes from racing computes.
   */
  private currentInferredEdgesRun = 0;

  constructor(
    store: GraphStore,
    _queryEngine: QueryEngine,
    config?: AIEngineConfig,
  ) {
    this.store = store;
    this.schemaSampleSize = config?.schemaSampleSize ?? 10;
    this.defaultSearchK = config?.defaultSearchK ?? 25;
    this.inspector = new SchemaInspector(store, {
      maxSamplesPerAttribute: this.schemaSampleSize,
    });
    this.keywordEngine = new SearchEngine(store);
  }

  /** Inject (or replace) the LLM provider. Triggers cache wipe if it changes. */
  setProvider(provider: LLMProvider | undefined): void {
    this.provider = provider;
    // Provider changes invalidate any in-flight or settled warmup — the next
    // ensureEmbeddings() call will compute fresh.
    this.warmupPromise = undefined;
    this.warmupSignature = undefined;
  }

  /** Get the current LLM provider, or `undefined` if none configured. */
  getProvider(): LLMProvider | undefined {
    return this.provider;
  }

  /** Inject (or replace) the response cache. Pass `undefined` to disable caching. */
  setCache(cache: CacheProvider | undefined): void {
    this.cache = cache;
    // Reset the provider tracker so the next call doesn't see a stale identity
    // and skip clearing a freshly-attached cache.
    this.lastProvider = undefined;
    this.warmupPromise = undefined;
    this.warmupSignature = undefined;
  }

  /** Get the current cache, or `undefined` if caching is disabled. */
  getCache(): CacheProvider | undefined {
    return this.cache;
  }

  /**
   * Inject (or replace) a dedicated {@link EmbeddingStore}. Pass `undefined`
   * to fall back to Tier 2 (cache) or Tier 1 (no embeddings) per the
   * progressive-enhancement contract.
   */
  setEmbeddingStore(store: EmbeddingStore | undefined): void {
    this.embeddingStore = store;
    this.warmupPromise = undefined;
    this.warmupSignature = undefined;
  }

  /** Get the current embedding store, or `undefined` if none configured. */
  getEmbeddingStore(): EmbeddingStore | undefined {
    return this.embeddingStore;
  }

  /**
   * Inject (or replace) the {@link InferredEdgeStore} used by Phase 5
   * inferred-relationship persistence. Pass `undefined` to disable inferred
   * edges entirely — calls to {@link computeInferredEdges} become no-ops.
   */
  setInferredEdgeStore(store: InferredEdgeStore | undefined): void {
    this.inferredEdgeStore = store;
  }

  /** Get the current inferred-edge store, or `undefined` if none configured. */
  getInferredEdgeStore(): InferredEdgeStore | undefined {
    return this.inferredEdgeStore;
  }

  /**
   * Phase 5 — compute and persist the inferred-relationship overlay.
   *
   * Hosts call this **explicitly** (typically once after data load completes
   * + embeddings have warmed). It does NOT auto-run on data changes;
   * recomputing is the host's responsibility.
   *
   * Each call recomputes from scratch and **replaces** the entire stored set
   * via {@link InferredEdgeStore.set} — there is no incremental merge.
   *
   * Tier detection:
   *   - {@link inferredEdgeStore} unset → no-op.
   *   - {@link embeddingStore} set → Tier 3 embedding path.
   *   - Else if {@link cache} set + provider has `embed` → Tier 2 embedding path.
   *   - Else → graph + LLM only (skip embedding source).
   *
   * The LLM source is skipped if no provider is configured, matching the
   * progressive-enhancement contract elsewhere in the AI surface.
   *
   * Honours `opts.signal`: when aborted mid-compute, the in-flight
   * sub-helpers stop and the function returns without touching the store.
   */
  async computeInferredEdges(opts?: ComputeInferredEdgesOptions): Promise<void> {
    if (!this.inferredEdgeStore) return;
    if (opts?.signal?.aborted) return;

    // Token-guard: stamp this run with a monotonically-increasing id and
    // bail out at every async boundary if a newer call has started since.
    // Mirrors the Phase 5 pattern in `ensureEmbeddings` — without it, a
    // fast-fired second compute could be overtaken by the slower first one
    // and clobber the freshest signal set with stale data.
    const myRun = ++this.currentInferredEdgesRun;
    const isStale = (): boolean =>
      myRun !== this.currentInferredEdgesRun || !!opts?.signal?.aborted;

    const requested = opts?.sources;
    const enabled = (s: InferredEdgeSource): boolean =>
      requested === undefined || requested.includes(s);

    const limitPerNode = opts?.limitPerNode ?? 5;
    const excludeExplicit = opts?.excludeExplicit ?? true;

    // -- Graph signals -----------------------------------------------------
    const graphCandidates = enabled('graph')
      ? computeGraphInferences(this.store, { limitPerNode })
      : [];
    if (isStale()) return;

    // -- Embedding signals -------------------------------------------------
    let embeddingCandidates: Awaited<
      ReturnType<typeof computeEmbeddingInferences>
    > = [];
    if (enabled('embedding')) {
      const tier = this.getEmbeddingTier();
      const model = this.provider ? inferModel(this.provider) : '';
      const modelVersion = '';
      if (tier === 'tier-3' && this.embeddingStore) {
        embeddingCandidates = await computeEmbeddingInferences({
          store: this.store,
          embeddingStore: this.embeddingStore,
          model,
          modelVersion,
          limitPerNode,
          signal: opts?.signal,
        });
      } else if (tier === 'tier-2' && this.cache && this.providerHasEmbed()) {
        const records = await this.loadCachedEmbeddings();
        const filtered = model
          ? records.filter((r) => r.meta.model === model)
          : records;
        embeddingCandidates = await computeEmbeddingInferences({
          store: this.store,
          cacheRecords: filtered,
          model,
          modelVersion,
          limitPerNode,
          signal: opts?.signal,
        });
      }
      // Tier 1: skip embedding source entirely.
    }
    if (isStale()) return;

    // -- LLM signals -------------------------------------------------------
    let llmCandidates: Awaited<ReturnType<typeof computeLLMInferences>> = [];
    if (enabled('llm') && this.provider) {
      llmCandidates = await computeLLMInferences({
        store: this.store,
        provider: this.provider,
        inspector: this.inspector,
        schemaSampleSize: this.schemaSampleSize,
        limitPerNode,
        cache: this.cache,
        signal: opts?.signal,
      });
    }
    if (isStale()) return;

    // -- Merge + persist ---------------------------------------------------
    const merged = mergeInferences(
      this.store,
      graphCandidates,
      embeddingCandidates,
      llmCandidates,
      { excludeExplicit },
    );
    if (isStale()) return;
    await this.inferredEdgeStore.set(merged);
  }

  /**
   * Drop the cached embedding(s) for `nodeId`. Called by {@link MemoryManager}
   * when an LRU eviction kicks in. No-op when no embedding storage is wired
   * (Tier 1) — there's nothing to drop.
   *
   * Tier 3: delegates to the embedding store's per-node bulk-delete pattern.
   * Since the {@link EmbeddingStore} contract doesn't expose a per-node
   * delete primitive, we fall back to the closest available API: re-set the
   * record to an empty placeholder is wrong, so we instead instruct stores
   * that implement an optional `delete(nodeId)` method (added by host
   * implementations) when present. Hosts that don't implement deletion still
   * benefit because the store removal closes the references.
   *
   * Tier 2: walks the cache index and removes any entry for `nodeId`. Cache
   * implementations expose `delete(key)` so we can do this directly.
   */
  async dropEmbedding(nodeId: string): Promise<void> {
    // Tier 3 — best-effort: store implementations may expose `delete(nodeId)`
    // even though it's not part of the v1 contract.
    if (this.embeddingStore) {
      const maybeDelete = (
        this.embeddingStore as unknown as {
          delete?: (nodeId: string) => void | Promise<void>;
        }
      ).delete;
      if (typeof maybeDelete === 'function') {
        try {
          await maybeDelete.call(this.embeddingStore, nodeId);
        } catch {
          // Eviction must never throw upstream.
        }
      }
    }
    // Tier 2 — walk the sidecar index, drop matching entries from it.
    // The {@link CacheProvider} contract has no per-key `delete` (only
    // bulk `clear`), so we only update the index here. Stale entries
    // remain in the cache until they age out via TTL or are bumped by the
    // cache's max-entries LRU. The index update is the canonical truth so
    // future `loadCachedEmbeddings()` calls won't surface them.
    if (this.cache) {
      try {
        const raw = await this.cache.get(EMBED_INDEX_KEY);
        const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        const remaining = list.filter((entry) => {
          const [entryNodeId] = entry.split('|');
          return entryNodeId !== nodeId;
        });
        if (remaining.length !== list.length) {
          await this.cache.set(EMBED_INDEX_KEY, JSON.stringify(remaining));
        }
      } catch {
        // Cache failures must not block eviction.
      }
    }
    // Drop any in-flight warmup signature so the next ensureEmbeddings()
    // re-evaluates the surface (the dropped node would otherwise stay
    // missing from the warmup view until the signature changes for an
    // unrelated reason).
    this.warmupSignature = undefined;
    this.warmupPromise = undefined;
  }

  /**
   * Drop every inferred edge incident to `nodeId`. Called by
   * {@link MemoryManager} when an LRU eviction kicks in so the inferred-edge
   * overlay doesn't keep dangling references to vanished nodes.
   *
   * No-op when no inferred-edge store is wired. Other inferred edges are
   * preserved; we re-`set` the filtered list so the store's invariants
   * (single composite-key entry per pair) still hold.
   */
  async dropInferredEdgesFor(nodeId: string): Promise<void> {
    if (!this.inferredEdgeStore) return;
    try {
      const all = await this.inferredEdgeStore.getAll();
      const remaining = all.filter(
        (e) => e.sourceId !== nodeId && e.targetId !== nodeId,
      );
      if (remaining.length === all.length) return;
      await this.inferredEdgeStore.set(remaining);
    } catch {
      // Eviction must never throw upstream.
    }
  }

  /**
   * Snapshot of every inferred edge currently persisted. Returns `[]` when
   * no {@link InferredEdgeStore} is configured.
   */
  async getInferredEdges(): Promise<ReadonlyArray<InferredEdge>> {
    if (!this.inferredEdgeStore) return [];
    return this.inferredEdgeStore.getAll();
  }

  /**
   * Detect which embedding storage tier is currently active. Tier 1 means
   * "no semantic search" — search() will fall back to keyword. Tier 2 uses
   * the cache as a vector store. Tier 3 uses a dedicated EmbeddingStore.
   *
   * Exposed for tests + diagnostics; consumers don't normally read this.
   */
  getEmbeddingTier(): EmbeddingTier {
    if (this.embeddingStore && this.providerHasEmbed()) return 'tier-3';
    if (this.cache && this.providerHasEmbed()) return 'tier-2';
    return 'tier-1';
  }

  /**
   * Compile a natural-language query into a predicate compatible with
   * `<InferaGraph filter>`. When no LLM provider is configured, returns the
   * permissive predicate `() => true` rather than throwing — this lets the
   * React layer wire the prop unconditionally.
   *
   * Behavior on a malformed LLM response: log a warning and return the
   * permissive predicate. We prefer "show everything" over "show nothing"
   * because the latter is harder for users to recover from (an empty viewport
   * looks like the app is broken).
   */
  async compileFilter(nlq: string): Promise<(node: NodeData) => boolean> {
    const trimmed = nlq?.trim() ?? '';
    if (trimmed.length === 0) return () => true;
    if (!this.provider) return () => true;

    const schema = this.discoverSchema();
    const prompt = this.buildFilterPrompt(trimmed, schema);

    let raw: string;
    try {
      raw = await this.cachedComplete(prompt, { format: 'json' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[InferaGraph AIEngine] LLM call failed during compileFilter:', err);
      return () => true;
    }

    const filterSpec = parseFilterSpec(raw);
    if (!filterSpec) return () => true;

    return buildPredicateFromSpec(filterSpec);
  }

  /**
   * Streaming chat / tool-call API. Yields a host-facing
   * {@link ChatEvent} stream:
   *   - `text` events flow through verbatim (one per LLM text delta).
   *   - `tool_call` events from the LLM are parsed into typed
   *     {@link ChatEvent}s (`apply_filter` / `highlight` / `focus` /
   *     `annotate`). By default these are NOT yielded to the host —
   *     callers that pass `emitToolCalls: true` see them too.
   *   - A final `done` event is always emitted (`stop` / `length` /
   *     `aborted` / on error with `error` populated).
   *
   * Caching: each chat call's prompt + tool definitions hash to a cache
   * key. Cached streams are replayed instantly (no artificial delay) so
   * tests + repeated identical queries don't pay the network cost twice.
   *
   * When no provider is configured, yields a single `done` event with
   * `error: 'no provider'` rather than throwing.
   */
  async *chat(
    message: string,
    opts?: ChatOptions,
  ): AsyncGenerator<ChatEvent, void, unknown> {
    const trimmed = message?.trim() ?? '';
    const emitToolCalls = !!opts?.emitToolCalls;
    const signal = opts?.signal;

    if (trimmed.length === 0) {
      yield { type: 'done', reason: 'stop' };
      return;
    }
    if (!this.provider) {
      yield { type: 'done', reason: 'stop', error: 'no provider' };
      return;
    }
    if (signal?.aborted) {
      yield { type: 'done', reason: 'aborted' };
      return;
    }

    const schema = this.discoverSchema();
    const prompt = this.buildChatPrompt(trimmed, schema);
    const tools = BUILT_IN_TOOLS;

    // ---- Cache: replay if we have one. ----
    const cacheKey = chatCacheKey(prompt, tools);
    const cached = await this.lookupChatCache(cacheKey);
    if (cached) {
      for (const ev of cached.events) {
        if (signal?.aborted) {
          yield { type: 'done', reason: 'aborted' };
          return;
        }
        for await (const out of this.translateLLMEvent(ev, emitToolCalls)) {
          yield out;
        }
        if (ev.type === 'done') return;
      }
      // Cached stream lacked a trailing done — synthesize one so consumers
      // always see a terminal event.
      yield { type: 'done', reason: 'stop' };
      return;
    }

    // ---- Live stream. ----
    const collected: LLMStreamEvent[] = [];
    let sawDone = false;
    try {
      const iter = this.provider.stream(prompt, { signal, tools });
      for await (const ev of iter) {
        collected.push(ev);
        if (ev.type === 'done') sawDone = true;
        for await (const out of this.translateLLMEvent(ev, emitToolCalls)) {
          yield out;
        }
        if (ev.type === 'done') break;
        if (signal?.aborted) {
          // Provider didn't honour signal yet; emit our own done.
          if (!sawDone) {
            const aborted: LLMStreamEvent = { type: 'done', reason: 'aborted' };
            collected.push(aborted);
            yield { type: 'done', reason: 'aborted' };
            sawDone = true;
          }
          break;
        }
      }
      if (!sawDone) {
        const synth: LLMStreamEvent = { type: 'done', reason: 'stop' };
        collected.push(synth);
        yield { type: 'done', reason: 'stop' };
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown stream error';
      const isAbort =
        signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      // Don't cache failed streams — only successful runs make it to cache.
      yield {
        type: 'done',
        reason: isAbort ? 'aborted' : 'stop',
        error: isAbort ? undefined : message,
      };
      return;
    }

    // Successful stream — persist for replay. Aborted streams are
    // intentionally not cached (the user cancelled before completion).
    if (!signal?.aborted) {
      await this.persistChatCache(cacheKey, collected);
    }
  }

  /**
   * Translate ONE provider {@link LLMStreamEvent} into zero-or-more host
   * {@link ChatEvent}s. Text + done events are always translated. Tool
   * calls are translated into typed events; whether they propagate
   * depends on `emitToolCalls`.
   */
  private async *translateLLMEvent(
    ev: LLMStreamEvent,
    emitToolCalls: boolean,
  ): AsyncGenerator<ChatEvent, void, unknown> {
    if (ev.type === 'text') {
      yield { type: 'text', delta: ev.delta };
      return;
    }
    if (ev.type === 'done') {
      yield { type: 'done', reason: ev.reason };
      return;
    }
    // tool_call
    const translated = parseToolCall(ev.name, ev.arguments);
    if (translated && emitToolCalls) {
      yield translated;
    }
    // We deliberately swallow translation failures rather than break the
    // stream — a malformed tool call is a model error, not a host error.
  }

  /**
   * Chat-cache lookup. Returns `null` on miss OR when no cache is
   * configured. Mirrors the provider-switch wipe semantics from
   * `cachedComplete`.
   */
  private async lookupChatCache(
    key: string,
  ): Promise<CachedChatReplay | null> {
    if (!this.cache || !this.provider) return null;
    if (this.lastProvider !== this.provider) {
      await this.cache.clear();
      this.lastProvider = this.provider;
      return null;
    }
    const raw = await this.cache.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CachedChatReplay;
      if (!parsed || !Array.isArray(parsed.events)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async persistChatCache(
    key: string,
    events: LLMStreamEvent[],
  ): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, JSON.stringify({ events }));
    } catch {
      // Cache failures must never break a chat — swallow.
    }
  }

  /**
   * Internal: dispatch through the cache if one is configured. Otherwise pass
   * straight to the provider. Switching provider instances clears the cache.
   */
  private async cachedComplete(prompt: string, opts?: CompleteOptions): Promise<string> {
    if (!this.provider) {
      throw new Error('AIEngine.cachedComplete called before setProvider');
    }

    if (this.cache && this.lastProvider !== this.provider) {
      // Provider switched (or this is the first cached call after setCache).
      // Wipe the cache so responses from a prior model can't bleed across.
      await this.cache.clear();
      this.lastProvider = this.provider;
    } else if (!this.cache) {
      this.lastProvider = this.provider;
    }

    if (!this.cache) {
      return this.provider.complete(prompt, opts);
    }

    const key = buildCacheKey(prompt, opts);
    const hit = await this.cache.get(key);
    if (hit !== undefined) return hit;

    const fresh = await this.provider.complete(prompt, opts);
    await this.cache.set(key, fresh);
    return fresh;
  }

  /**
   * Phase 3: idempotent batch warmup. Walks the store, computes content
   * hashes per node, and embeds anything missing from the active store
   * (cache for Tier 2, embeddingStore for Tier 3). No-op for Tier 1.
   *
   * Concurrent callers with the same `(provider, data)` signature share a
   * single in-flight Promise so we never run two batches in parallel. The
   * Promise resolves once every node has a fresh-or-cached embedding.
   *
   * Errors during a single node's embed are swallowed (logged via console)
   * so one bad text doesn't block search for the rest. The next call will
   * retry the failures.
   */
  ensureEmbeddings(): Promise<void> {
    const tier = this.getEmbeddingTier();
    if (tier === 'tier-1') return Promise.resolve();

    const sig = this.computeWarmupSignature();
    if (this.warmupPromise && this.warmupSignature === sig) {
      return this.warmupPromise;
    }
    this.warmupSignature = sig;
    this.warmupPromise = this.runWarmup(tier).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[InferaGraph AIEngine] ensureEmbeddings failed:', err);
    });
    return this.warmupPromise;
  }

  /**
   * Phase 4: single search entry-point. Auto-detects keyword vs semantic
   * routing based on the query shape:
   *
   *   - Short token-only inputs (≤3 whitespace-separated tokens, lowercase
   *     letters/digits/hyphens, no punctuation) → keyword search via the
   *     existing data-layer SearchEngine. Always available.
   *   - Anything else (sentences, NLQ, mixed-case prose) → semantic search
   *     via {@link provider.embed} + the active embedding store. When
   *     embeddings aren't available (Tier 1), falls back to keyword.
   *
   * Returns at most `opts.k ?? 25` hits, sorted by descending score. An
   * empty / whitespace-only query returns `[]`.
   */
  async search(
    query: string,
    opts?: { k?: number; signal?: AbortSignal },
  ): Promise<SearchResult[]> {
    const trimmed = query?.trim() ?? '';
    if (trimmed.length === 0) return [];
    const k = opts?.k ?? this.defaultSearchK;
    const signal = opts?.signal;
    if (signal?.aborted) return [];

    const tier = this.getEmbeddingTier();
    const isKeyword = isKeywordShape(trimmed);
    if (isKeyword || tier === 'tier-1') {
      return this.runKeywordSearch(trimmed, k);
    }

    return this.runSemanticSearch(trimmed, k, signal);
  }

  /** Run keyword search via the data-layer SearchEngine and shape results. */
  private runKeywordSearch(query: string, k: number): SearchResult[] {
    const raw = this.keywordEngine.search(query);
    const out: SearchResult[] = [];
    for (const r of raw) {
      const matchedField = pickMatchedField(r.matches);
      out.push({ nodeId: r.nodeId, score: r.score, matchedField });
      if (out.length >= k) break;
    }
    return out;
  }

  /**
   * Run semantic search: embed the query, ensure node embeddings are warm,
   * then delegate to the active store's similarity API (Tier 3) or compute
   * cosine in-memory across cache entries (Tier 2).
   */
  private async runSemanticSearch(
    query: string,
    k: number,
    signal: AbortSignal | undefined,
  ): Promise<SearchResult[]> {
    if (!this.providerHasEmbed() || !this.provider) return [];
    const embedFn = this.provider.embed!.bind(this.provider);

    // Kick off warmup but don't block the user's query — we'll search
    // whatever's already embedded. The warmup completes in the background
    // and benefits subsequent queries.
    void this.ensureEmbeddings();

    let queryVectors: Vector[];
    try {
      queryVectors = await embedFn([query], { signal });
    } catch {
      return [];
    }
    const queryVector = queryVectors[0];
    if (!queryVector || queryVector.length === 0) return [];
    if (signal?.aborted) return [];

    const tier = this.getEmbeddingTier();
    const model = inferModel(this.provider);
    if (tier === 'tier-3' && this.embeddingStore) {
      const hits = await this.embeddingStore.similar(queryVector, k, model, '');
      return hits.map((h) => ({ nodeId: h.nodeId, score: h.score }));
    }
    // Tier 2: cache as vector store. Load the index + every record, score in-memory.
    const records = await this.loadCachedEmbeddings();
    const filtered = model
      ? records.filter((r) => r.meta.model === model)
      : records;
    const seen = new Map<string, number>();
    for (const r of filtered) {
      const score = cosineSimilarity(queryVector, r.vector);
      if (Number.isNaN(score)) continue;
      const prev = seen.get(r.nodeId);
      if (prev === undefined || score > prev) seen.set(r.nodeId, score);
    }
    const hits: SearchResult[] = [];
    for (const [nodeId, score] of seen) hits.push({ nodeId, score });
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  /** Returns true when the configured provider exposes the optional `embed` method. */
  private providerHasEmbed(): boolean {
    return !!this.provider && typeof this.provider.embed === 'function';
  }

  /** Internal: signature used to detect when an in-flight warmup is stale. */
  private computeWarmupSignature(): string {
    const providerName = this.provider?.name ?? '';
    const tier = this.getEmbeddingTier();
    return `${providerName}|${tier}|${this.store.nodeCount}`;
  }

  /** Internal: actual warmup body. Runs once per signature. */
  private async runWarmup(tier: EmbeddingTier): Promise<void> {
    if (!this.provider || !this.providerHasEmbed()) return;
    const embedFn = this.provider.embed!.bind(this.provider);
    const model = inferModel(this.provider);
    const modelVersion = '';
    const nodes = this.store.getAllNodes();

    // Determine which nodes need fresh embeddings (missing or content-hash mismatch).
    const pending: Array<{ node: NodeData; text: string; hash: string }> = [];
    for (const storeNode of nodes) {
      const node: NodeData = {
        id: storeNode.id,
        attributes: storeNode.attributes,
      };
      const text = embeddingText(node);
      const hash = computeContentHash(text);
      const existing = await this.lookupEmbedding(node.id, model, modelVersion, hash);
      if (existing) continue;
      pending.push({ node, text, hash });
    }
    if (pending.length === 0) return;

    // Batch the embed call — providers handle their own internal batching too,
    // but we send a single array per warmup pass for fewer round-trips.
    const texts = pending.map((p) => p.text);
    let vectors: Vector[];
    try {
      vectors = await embedFn(texts);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[InferaGraph AIEngine] embed batch failed:', err);
      return;
    }
    const generatedAt = new Date().toISOString();
    for (let i = 0; i < pending.length; i++) {
      const vector = vectors[i];
      if (!vector) continue;
      const record: EmbeddingRecord = {
        nodeId: pending[i].node.id,
        vector,
        meta: {
          model,
          modelVersion,
          generatedAt,
          contentHash: pending[i].hash,
        },
      };
      await this.persistEmbedding(record, tier);
    }
  }

  private async lookupEmbedding(
    nodeId: string,
    model: string,
    modelVersion: string,
    hash: string,
  ): Promise<EmbeddingRecord | undefined> {
    if (this.embeddingStore) {
      return this.embeddingStore.get(nodeId, model, modelVersion, hash);
    }
    if (this.cache) {
      const raw = await this.cache.get(embedCacheKey(nodeId, model, modelVersion, hash));
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw) as EmbeddingRecord;
        if (parsed && Array.isArray(parsed.vector) && parsed.meta) return parsed;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async persistEmbedding(
    record: EmbeddingRecord,
    tier: EmbeddingTier,
  ): Promise<void> {
    if (tier === 'tier-3' && this.embeddingStore) {
      await this.embeddingStore.set(record);
      return;
    }
    if (tier === 'tier-2' && this.cache) {
      const key = embedCacheKey(
        record.nodeId,
        record.meta.model,
        record.meta.modelVersion,
        record.meta.contentHash,
      );
      try {
        await this.cache.set(key, JSON.stringify(record));
      } catch {
        // Cache failures must never break warmup.
      }
      // Also maintain a sidecar index so Tier 2 similarity can enumerate
      // every embedded nodeId without scanning unrelated cache keys.
      await this.appendToCacheIndex(record.nodeId, record.meta.model, record.meta.modelVersion, record.meta.contentHash);
    }
  }

  private async appendToCacheIndex(
    nodeId: string,
    model: string,
    modelVersion: string,
    hash: string,
  ): Promise<void> {
    if (!this.cache) return;
    try {
      const raw = await this.cache.get(EMBED_INDEX_KEY);
      const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      const entry = `${nodeId}|${model}|${modelVersion}|${hash}`;
      if (!list.includes(entry)) list.push(entry);
      await this.cache.set(EMBED_INDEX_KEY, JSON.stringify(list));
    } catch {
      // Index failures are non-fatal — similarity will degrade but not crash.
    }
  }

  /**
   * Load every cached embedding record (Tier 2). Walks the sidecar index,
   * fetches each entry, drops malformed values silently.
   */
  private async loadCachedEmbeddings(): Promise<EmbeddingRecord[]> {
    if (!this.cache) return [];
    let list: string[] = [];
    try {
      const raw = await this.cache.get(EMBED_INDEX_KEY);
      list = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
    const records: EmbeddingRecord[] = [];
    for (const entry of list) {
      const [nodeId, model, modelVersion, hash] = entry.split('|');
      if (!nodeId) continue;
      const raw = await this.cache.get(embedCacheKey(nodeId, model ?? '', modelVersion ?? '', hash ?? ''));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as EmbeddingRecord;
        if (parsed && Array.isArray(parsed.vector) && parsed.meta) records.push(parsed);
      } catch {
        // skip
      }
    }
    return records;
  }

  /**
   * Internal: compatibility wrapper used by the prompt builders. Returns
   * the same key→samples shape the legacy code expected, but sourced
   * from the new {@link SchemaInspector}.
   */
  private discoverSchema(): SchemaSummary {
    const summary = this.inspector.summary();
    const out: SchemaSummary = new Map();
    for (const [key, attr] of summary.attributes) {
      out.set(key, new Set(attr.samples));
    }
    return out;
  }

  /**
   * Internal: build the prompt sent to the LLM. The output contract is a
   * single JSON object whose keys are attribute names and whose values are
   * arrays of strings; a node matches when, for EVERY key, its attribute
   * value is one of the supplied strings (membership test). Empty object → match all.
   */
  private buildFilterPrompt(nlq: string, schema: SchemaSummary): string {
    const schemaBlock = renderSchemaBlock(schema, this.schemaSampleSize);

    return [
      'You are compiling a natural-language graph filter into JSON.',
      'The dataset has these node attribute keys (each with a small sample of observed values):',
      schemaBlock,
      '',
      'Output a single JSON object. Keys are attribute names; values are arrays of strings.',
      'A node matches when, for EVERY key in the object, the node\'s attribute value (or, if the attribute is an array, ANY element of the array) is one of the listed strings.',
      'An empty object {} matches every node.',
      'Use ONLY attribute keys from the schema above. Do not add commentary, code fences, or prose — return JSON only.',
      '',
      `Query: ${nlq}`,
    ].join('\n');
  }

  /**
   * Build the system + user prompt sent to the LLM for `chat()`. The
   * prompt teaches the LLM about the available tools (visual instructions)
   * AND the dataset schema so it can construct valid `apply_filter` specs.
   */
  private buildChatPrompt(message: string, schema: SchemaSummary): string {
    const schemaBlock = renderSchemaBlock(schema, this.schemaSampleSize);
    return [
      'You are an assistant embedded inside an interactive graph visualization.',
      'You help the user explore the graph by emitting a mix of conversational text and visual-instruction tool calls.',
      '',
      'Available tools:',
      '- apply_filter(spec): restrict which nodes are visible.',
      '- highlight(ids): emphasize a set of nodes; others dim.',
      '- focus(nodeId): animate the camera to a node.',
      '- annotate(nodeId, text): attach a sticky note to a node.',
      '',
      'Dataset schema (attribute keys and a sample of observed values):',
      schemaBlock,
      '',
      'When the user asks a visual question (e.g. "show me only X"), prefer emitting a tool call. When they ask for explanation, emit conversational text.',
      '',
      `User: ${message}`,
    ].join('\n');
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SchemaSummary = Map<string, Set<string>>;

/** Sidecar cache key listing every (nodeId|model|version|hash) entry persisted. */
const EMBED_INDEX_KEY = '__inferagraph_embed_index__';

/**
 * Cache key for a Tier 2 embedding entry. The key prefix lets callers
 * recognise our entries vs other consumer-owned cache slots, and the
 * composite suffix matches {@link EmbeddingStore.get}'s contract.
 */
function embedCacheKey(
  nodeId: string,
  model: string,
  modelVersion: string,
  hash: string,
): string {
  return `embed|${escapePipe(nodeId)}|${model}|${modelVersion}|${hash}`;
}

function escapePipe(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Decide whether a query is "keyword-shaped" (≤3 lowercase tokens, no
 * punctuation other than hyphens) vs sentence/NLQ-shaped. Threshold tuned
 * to handle typical lookup intents like `"adam"`, `"sons of noah"`,
 * `"early-patriarchs"` while routing anything sentence-shaped (containing
 * uppercase letters mid-string, punctuation, or 4+ tokens) to semantic.
 */
export function isKeywordShape(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return true;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length > 3) return false;
  for (const token of tokens) {
    if (!/^[a-z0-9-]+$/.test(token)) return false;
  }
  return true;
}

/**
 * Pick the attribute key for a `SearchResult.matchedField`. Data-layer
 * `SearchEngine` returns matches as `"key: value"` strings; we strip down
 * to the key for the AI-side shape.
 */
function pickMatchedField(matches: string[]): string | undefined {
  if (matches.length === 0) return undefined;
  const first = matches[0];
  const colon = first.indexOf(':');
  return colon > 0 ? first.slice(0, colon) : first;
}

/**
 * Pull the embedding model name from a provider for cache scoping. Providers
 * may expose it via a `defaultEmbeddingModel` getter; absent that, we fall
 * back to the provider's `name` (which is enough to keep model families
 * apart in practice).
 */
function inferModel(provider: LLMProvider): string {
  const candidate = (provider as unknown as { defaultEmbeddingModel?: string })
    .defaultEmbeddingModel;
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  return provider.name;
}

function renderSchemaBlock(
  schema: SchemaSummary,
  sampleSize: number,
): string {
  const lines: string[] = [];
  for (const [key, values] of schema) {
    const samples = [...values].slice(0, sampleSize);
    lines.push(`- ${key}: ${samples.join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no attributes)';
}

/**
 * Parse a raw JSON string into a {@link FilterSpec}. Returns `undefined`
 * on any malformed input. Strips optional Markdown fencing (some models
 * add ``` despite instructions).
 */
export function parseFilterSpec(raw: string): FilterSpec | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const spec: FilterSpec = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const stringified: string[] = [];
    for (const v of value) {
      if (typeof v === 'string') stringified.push(v);
      else if (typeof v === 'number' || typeof v === 'boolean') stringified.push(String(v));
    }
    if (stringified.length > 0) spec[key] = stringified;
  }
  return spec;
}

/**
 * Parse a raw tool call from the LLM into a typed {@link ChatEvent}.
 * Returns `null` on unknown tool names, malformed JSON, or invalid argument
 * shapes — callers must NOT propagate the bad call to the renderer.
 */
export function parseToolCall(
  name: string,
  argsJson: string,
): ChatEvent | null {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const a = args as Record<string, unknown>;

  switch (name) {
    case 'apply_filter': {
      // Two accepted shapes for forgiveness with provider quirks:
      //   { spec: { ... } }  (canonical)
      //   { ... }            (the spec inlined directly)
      const candidate =
        a.spec && typeof a.spec === 'object' && !Array.isArray(a.spec)
          ? (a.spec as Record<string, unknown>)
          : a;
      const spec = coerceFilterSpec(candidate);
      if (!spec) return null;
      return {
        type: 'apply_filter',
        spec,
        predicate: buildPredicateFromSpec(spec),
      };
    }
    case 'highlight': {
      const ids = a.ids;
      if (!Array.isArray(ids)) return null;
      const out = new Set<string>();
      for (const id of ids) {
        if (typeof id === 'string') out.add(id);
      }
      return { type: 'highlight', ids: out };
    }
    case 'focus': {
      const nodeId = a.nodeId;
      if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
      return { type: 'focus', nodeId };
    }
    case 'annotate': {
      const nodeId = a.nodeId;
      const text = a.text;
      if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
      if (typeof text !== 'string') return null;
      return { type: 'annotate', nodeId, text };
    }
    case 'set_inferred_visibility': {
      const visible = a.visible;
      if (typeof visible !== 'boolean') return null;
      return { type: 'set_inferred_visibility', visible };
    }
    default:
      return null;
  }
}

function coerceFilterSpec(
  raw: Record<string, unknown>,
): FilterSpec | undefined {
  const spec: FilterSpec = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    const stringified: string[] = [];
    for (const v of value) {
      if (typeof v === 'string') stringified.push(v);
      else if (typeof v === 'number' || typeof v === 'boolean') stringified.push(String(v));
    }
    if (stringified.length > 0) spec[key] = stringified;
  }
  return Object.keys(spec).length > 0 ? spec : (raw && Object.keys(raw).length === 0 ? spec : spec);
}

/**
 * Build a node predicate from a parsed filter spec. A node matches when, for
 * every (key, allowedValues) pair in the spec, the node's attribute value (or
 * any element of an array attribute) is contained in `allowedValues`. An empty
 * spec matches every node.
 */
export function buildPredicateFromSpec(
  spec: FilterSpec,
): (node: NodeData) => boolean {
  const entries = Object.entries(spec).filter(
    (entry): entry is [string, string[]] => Array.isArray(entry[1]),
  );
  if (entries.length === 0) return () => true;

  return (node: NodeData) => {
    for (const [key, allowed] of entries) {
      const value = node.attributes[key];
      if (value == null) return false;
      if (Array.isArray(value)) {
        let any = false;
        for (const item of value) {
          if (typeof item === 'string' && allowed.includes(item)) {
            any = true;
            break;
          }
          if (
            (typeof item === 'number' || typeof item === 'boolean') &&
            allowed.includes(String(item))
          ) {
            any = true;
            break;
          }
        }
        if (!any) return false;
      } else if (typeof value === 'string') {
        if (!allowed.includes(value)) return false;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        if (!allowed.includes(String(value))) return false;
      } else {
        return false;
      }
    }
    return true;
  };
}

/**
 * Stable cache key derived from the prompt + the response-shaping options.
 *
 * We deliberately use a portable FNV-1a hash (not Node's `crypto`) so the
 * bundle works in browsers and edge runtimes without a polyfill. Hash is
 * 64-bit (two 32-bit halves concatenated), which is collision-resistant
 * enough for an LRU cache: a collision merely reuses a previously-cached
 * answer, and the LRU surface is bounded.
 *
 * Provider name is intentionally NOT in the key — provider switches are
 * handled by `cache.clear()` instead, so tests can swap providers without
 * key collisions.
 */
function buildCacheKey(prompt: string, opts: CompleteOptions | undefined): string {
  const hash = fnv1a64(prompt);
  const format = opts?.format ?? 'text';
  const temperature = opts?.temperature ?? '';
  const maxTokens = opts?.maxTokens ?? '';
  return `${hash}|${format}|${temperature}|${maxTokens}`;
}

/**
 * Cache key for a chat prompt + tool definition list. Tool definitions
 * are folded into the hash so changing the tool surface invalidates
 * cached responses.
 */
function chatCacheKey(prompt: string, tools: LLMToolDefinition[]): string {
  const toolSig = tools
    .map((t) => `${t.name}:${stableStringify(t.parameters)}`)
    .join('|');
  return `chat|${fnv1a64(prompt)}|${fnv1a64(toolSig)}`;
}

/**
 * Order-stable JSON.stringify so cache keys don't change just because an
 * object's key insertion order does. Sufficient for the small JSON-Schema
 * objects we feed it.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + stableStringify(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * 64-bit FNV-1a hash, returned as a 16-char hex string. Implemented with
 * two 32-bit halves so we don't need BigInt support in older runtimes.
 */
function fnv1a64(input: string): string {
  // Initial offset basis split into hi/lo 32-bit halves: 0xcbf29ce484222325
  let hi = 0xcbf29ce4 | 0;
  let lo = 0x84222325 | 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // XOR low byte into the low half (FNV-1a operates on bytes, but for
    // string inputs char code XOR is sufficient for our cache-key purpose).
    lo = (lo ^ code) >>> 0;
    // Multiply by FNV prime 0x100000001b3 = (1 << 40) + (1 << 8) + 0xb3
    // 64-bit mul split: prime hi = 0x100, prime lo = 0x000001b3
    const PRIME_HI = 0x100;
    const PRIME_LO = 0x000001b3;
    const loMul = Math.imul(lo, PRIME_LO);
    const hiMul = Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI);
    lo = loMul >>> 0;
    hi = (hiMul + ((loMul / 0x100000000) | 0)) >>> 0;
  }
  return ((hi >>> 0).toString(16).padStart(8, '0')) + ((lo >>> 0).toString(16).padStart(8, '0'));
}

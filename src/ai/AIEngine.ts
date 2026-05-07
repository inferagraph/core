import type { NodeData } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import type { CacheProvider } from '../cache/lruCache.js';
import { SearchEngine } from '../store/SearchEngine.js';
import type {
  CompleteOptions,
  LLMMessage,
  LLMProvider,
  LLMStreamEvent,
  LLMToolDefinition,
  StreamOptions,
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
import type {
  ConversationStore,
  ConversationTurn,
} from './ConversationStore.js';
import {
  injectCitations,
  type CitationCandidate,
} from './citationInjector.js';

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
  /**
   * Maximum number of nodes to include in the relevant-nodes catalog the
   * chat prompt embeds in its system message. For graphs <= this size the
   * full catalog is included; larger graphs are reduced via embedding
   * search (or keyword search when embeddings are not yet warm) against
   * the user's message. Default: 12.
   */
  chatContextSize?: number;
  /**
   * Maximum number of nodes whose `attributes.content` is embedded as
   * full retrieval-augmented context in the chat system message. Counts
   * the top-K most-relevant nodes from the same ranking the catalog
   * uses. Defaults to 4. If the catalog is smaller than K the engine
   * includes content for whichever nodes are present (no padding).
   */
  chatContentSize?: number;
  /**
   * Per-node byte cap applied to `attributes.content` before it is
   * inlined into the system message. Anything beyond the cap is trimmed
   * and a Unicode ellipsis (`…`) is appended so the model can tell the
   * text is partial. Defaults to 800.
   */
  chatContentMaxTokens?: number;
  /**
   * Total byte budget for the inlined content section. When the sum of
   * per-node content (after per-node truncation) exceeds the budget, the
   * engine drops the lowest-relevance nodes' content first until the
   * total fits — those nodes still appear in the catalog without their
   * content body. Defaults to 3200.
   */
  chatContentBudgetTokens?: number;
  /**
   * Per-host content-priority keys passed to {@link embeddingText}. The
   * engine uses these for both warmup embeddings and prompt rendering.
   * Default: `['content', 'description', 'body', 'summary']` (the same
   * defaults {@link embeddingText} ships).
   */
  embeddingContentKeys?: readonly string[];
  /**
   * Whether to run the cross-encoder rerank pass after hybrid retrieval.
   * Default `true`. Disable to save the per-candidate `provider.complete`
   * calls (faster + cheaper, lower quality).
   */
  chatRerankEnabled?: boolean;
  /**
   * How many candidates the hybrid-retrieval merger feeds to the rerank
   * pass. Default 20.
   */
  chatRerankCandidates?: number;
  /**
   * How many candidates survive the rerank pass and reach the chat prompt.
   * Default 8.
   */
  chatRerankTopK?: number;
  /**
   * How many prior conversation turns to splice into the chat messages
   * array when a {@link ConversationStore} is set. Default 8.
   */
  priorTurnLimit?: number;
  /**
   * When set, names a node attribute key whose value is the citation
   * token format (e.g., 'slug'). The catalog block will include a
   * separate citation-key column, and the system prompt's citation
   * requirement instructs the model to use that column for `[[...]]`
   * tokens. When unset, citations use the catalog's primary id (the
   * `node.id` value, typically a UUID for stable backends).
   *
   * Hosts whose ids are user-friendly (slugs/short names) can leave
   * this unset; hosts with UUID ids should set this to the friendly
   * attribute key (Bible Graph: `'slug'`).
   */
  citationKey?: string;
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
      'Restrict which nodes are visible. Use ONLY when the user EXPLICITLY asks to filter ("show only X", "hide events") — never auto-filter in response to a question about the data, because that hides the answer. Pass a domain-agnostic filter spec keyed by node attribute names. A node matches when, for EVERY key in the spec, the node\'s attribute value (or any element of an array attribute) is one of the listed strings.',
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
      'Highlight every node referenced in your answer — the subject of the question PLUS the objects of the answer. Other nodes fade automatically. Pass an empty list to clear the highlight. This tool MUST accompany the streamed text on every graph-relevant response.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Node ids to highlight. Include EVERY node referenced by your answer, including the subject of the user\'s question.',
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
  private readonly chatContextSize: number;
  private readonly chatContentSize: number;
  private readonly chatContentMaxTokens: number;
  private readonly chatContentBudgetTokens: number;
  private readonly embeddingContentKeys: readonly string[];
  private readonly chatRerankEnabled: boolean;
  private readonly chatRerankCandidates: number;
  private readonly chatRerankTopK: number;
  private readonly priorTurnLimit: number;
  private readonly citationKey: string | undefined;
  private readonly inspector: SchemaInspector;
  private readonly keywordEngine: SearchEngine;
  private provider: LLMProvider | undefined;
  private cache: CacheProvider | undefined;
  private embeddingStore: EmbeddingStore | undefined;
  private inferredEdgeStore: InferredEdgeStore | undefined;
  private conversationStore: ConversationStore | undefined;
  /** Per-process rerank cache, keyed by `(conversationId, queryHash, candidateIds)`. */
  private readonly rerankCache = new Map<string, string[]>();
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
  /**
   * Buffer of warmup-path failures that happened OUTSIDE an active chat
   * stream (typically background `ensureEmbeddings()` kicks fired by
   * `setEmbeddingStore` / search). The next `chat()` call drains this buffer
   * as `debug` events with phase `warmup-failed` so consumers see the
   * diagnostic on the assistant turn instead of via stderr `console.warn`.
   * Per chat call the buffer is fully consumed; entries are not repeated.
   */
  private pendingWarmupFailures: string[] = [];

  /**
   * 0.12.0 — memoized `{ token, title }[]` pairs derived from the WHOLE
   * store. The injector consumes this list per chat turn; recomputing
   * on each turn at biblegraph scale (~hundreds to low thousands of
   * nodes) is single-digit ms, but we cache it keyed by `nodeCount` so
   * back-to-back turns on a stable graph reuse the same array. When the
   * node count changes (add/remove), the cache invalidates and rebuilds
   * on the next access.
   */
  private citationCandidatesCache:
    | { nodeCount: number; candidates: readonly CitationCandidate[] }
    | undefined;

  constructor(
    store: GraphStore,
    _queryEngine: QueryEngine,
    config?: AIEngineConfig,
  ) {
    this.store = store;
    this.schemaSampleSize = config?.schemaSampleSize ?? 10;
    this.defaultSearchK = config?.defaultSearchK ?? 25;
    this.chatContextSize = config?.chatContextSize ?? 12;
    this.chatContentSize = config?.chatContentSize ?? 4;
    this.chatContentMaxTokens = config?.chatContentMaxTokens ?? 800;
    this.chatContentBudgetTokens = config?.chatContentBudgetTokens ?? 3200;
    this.embeddingContentKeys = config?.embeddingContentKeys ?? [
      'content',
      'description',
      'body',
      'summary',
    ];
    this.chatRerankEnabled = config?.chatRerankEnabled ?? true;
    this.chatRerankCandidates = config?.chatRerankCandidates ?? 20;
    this.chatRerankTopK = config?.chatRerankTopK ?? 8;
    this.priorTurnLimit = config?.priorTurnLimit ?? 8;
    this.citationKey =
      typeof config?.citationKey === 'string' && config.citationKey.length > 0
        ? config.citationKey
        : undefined;
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
   * Inject (or replace) the {@link ConversationStore} used by multi-turn
   * chat memory. Pass `undefined` to disable conversation memory entirely
   * — chat calls then ignore the `conversationId` opt and never persist
   * turns.
   */
  setConversationStore(store: ConversationStore | undefined): void {
    this.conversationStore = store;
  }

  /** Get the current conversation store, or `undefined` if none configured. */
  getConversationStore(): ConversationStore | undefined {
    return this.conversationStore;
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
   * Honors `opts.signal`: when aborted mid-compute, the in-flight
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
    const conversationId = opts?.conversationId;

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

    // Drain any buffered warmup failures from background `ensureEmbeddings`
    // kicks. These were captured silently (no `console.warn`) so the chat
    // turn is the diagnostic surface — hosts render them as grey debug
    // badges underneath the assistant bubble.
    if (this.pendingWarmupFailures.length > 0) {
      const failures = this.pendingWarmupFailures.slice();
      this.pendingWarmupFailures.length = 0;
      for (const detail of failures) {
        yield {
          type: 'debug',
          phase: 'warmup-failed',
          detail,
          conversationId,
        };
      }
    }

    // Fetch prior turns ONLY when both a conversationId is supplied AND a
    // store is configured. The pronoun-resolution block uses the most
    // recent assistant turn's `retrievedNodeIds`.
    let priorTurns: ConversationTurn[] = [];
    let priorRetrievedIds: string[] = [];
    if (conversationId && this.conversationStore) {
      try {
        priorTurns = await this.conversationStore.getTurns(
          conversationId,
          this.priorTurnLimit,
        );
      } catch {
        priorTurns = [];
      }
      // Pull retrievedNodeIds from the most recent assistant turn for
      // pronoun resolution.
      for (let i = priorTurns.length - 1; i >= 0; i--) {
        if (priorTurns[i].role === 'assistant' && priorTurns[i].retrievedNodeIds) {
          priorRetrievedIds = priorTurns[i].retrievedNodeIds!.slice();
          break;
        }
      }
    }

    const schema = this.discoverSchema();
    await this.refreshInferredEdgesSnapshot();
    // Hybrid retrieval — semantic + keyword + 1-hop graph expansion.
    const retrievalResult = await this.runHybridRetrieval(trimmed);
    let relevantNodes = retrievalResult.nodes;
    let emittedRetrievalEmpty = false;
    if (relevantNodes.length === 0) {
      // Engine no longer head-truncates the catalog — empty stays empty.
      yield {
        type: 'debug',
        phase: 'retrieval-empty',
        detail: 'no semantic, keyword, or graph-expansion hits',
        conversationId,
      };
      emittedRetrievalEmpty = true;
    }

    // Cross-encoder rerank pass (gated by config).
    if (
      this.chatRerankEnabled &&
      relevantNodes.length > 0 &&
      this.provider
    ) {
      relevantNodes = await this.runRerank(
        trimmed,
        relevantNodes,
        conversationId,
      );
    }

    // Detect pronouns; only inject the prior-entities block when both
    // pronouns AND prior retrievedNodeIds are present.
    const usePronounBlock =
      hasPronouns(trimmed) && priorRetrievedIds.length > 0;
    const pronounIds = usePronounBlock ? priorRetrievedIds : [];

    const baseMessages = this.buildChatMessages(
      trimmed,
      schema,
      relevantNodes,
      { pronounIds },
    );
    // Splice prior turns BETWEEN the system message and the current user
    // message so the model sees: [system, ...prior, current-user].
    const messages: LLMMessage[] = [
      baseMessages[0], // system
      ...priorTurns.map((t) => ({
        role: t.role,
        content: t.content,
      })),
      baseMessages[1], // current user
    ];
    const tools = BUILT_IN_TOOLS;
    void emittedRetrievalEmpty;

    // ---- Cache: replay if we have one. The key hashes the structured
    //      messages array deterministically so a system-message edit
    //      invalidates cached replays automatically. ----
    const cacheKey = chatCacheKey(messages, tools);
    const cached = await this.lookupChatCache(cacheKey);
    if (cached) {
      for await (const ev of this.emitWithFallbacks(
        cached.events,
        emitToolCalls,
        relevantNodes,
        signal,
      )) {
        yield ev;
      }
      return;
    }

    // ---- Live stream. The malformed-tool-call retry loop runs at most
    //      MAX_RETRIES + 1 = 2 invocations of the provider per chat turn. ----
    const MAX_RETRIES = 1;
    const provider = this.provider;
    let activeMessages: LLMMessage[] = messages.slice();
    const collected: LLMStreamEvent[] = [];
    let attempt = 0;
    let abortedDuringStream = false;
    let assistantText = '';

    try {
      while (attempt <= MAX_RETRIES) {
        const isFinalAttempt = attempt === MAX_RETRIES;
        const attemptEvents: LLMStreamEvent[] = [];
        const heldToolCalls: Array<
          Extract<LLMStreamEvent, { type: 'tool_call' }>
        > = [];
        let invalidToolEvent:
          | Extract<LLMStreamEvent, { type: 'tool_call' }>
          | undefined;
        let invalidReason: string | undefined;

        for await (const ev of this.invokeProvider(
          provider,
          activeMessages,
          { signal, tools },
        )) {
          attemptEvents.push(ev);
          if (ev.type === 'tool_call') {
            const validation = validateToolArgs(ev.name, ev.arguments);
            if (validation.ok) {
              heldToolCalls.push(ev);
            } else if (!isFinalAttempt && invalidToolEvent === undefined) {
              // Hold the bad call back so it never reaches the host. We
              // will retry once with a corrective system message.
              invalidToolEvent = ev;
              invalidReason = validation.reason;
            } else {
              // Final attempt — drop the malformed call (translateLLMEvent
              // would have done the same), no leak.
            }
            continue;
          }
          if (signal?.aborted) {
            if (ev.type !== 'done') {
              abortedDuringStream = true;
            }
            break;
          }
        }

        // Did we trigger a retry? If so, build the corrective messages and
        // loop without yielding anything from this attempt.
        if (invalidToolEvent && !signal?.aborted) {
          activeMessages = appendCorrectionForRetry(
            activeMessages,
            invalidToolEvent,
            invalidReason ?? 'invalid arguments',
            relevantNodes,
          );
          attempt += 1;
          // eslint-disable-next-line no-console
          console.warn(
            `[InferaGraph AIEngine] retrying chat after malformed tool call: ${invalidToolEvent.name} ${invalidToolEvent.arguments} — ${invalidReason}`,
          );
          continue;
        }

        // No retry needed — emit everything we collected this attempt
        // through the fallback-aware emitter, which substitutes empty
        // highlights and synthesizes a text event when the model was
        // text-silent.
        for (const ev of attemptEvents) collected.push(ev);
        for await (const out of this.emitWithFallbacks(
          attemptEvents,
          emitToolCalls,
          relevantNodes,
          signal,
        )) {
          if (out.type === 'text') assistantText += out.delta;
          // 0.11.0 — `text_replace` carries the citation-corrected final
          // text. Use IT for conversation-store persistence so prior turns
          // (and the pronoun-resolve `retrievedNodeIds` plumbing) see the
          // cited form rather than the streamed-uncited fragments.
          if (out.type === 'text_replace') assistantText = out.text;
          yield out;
        }
        break;
      }

      // Suppress unused-variable lints when the abort flag wasn't read in a
      // particular code path; it is consumed by the cache-skip below.
      void abortedDuringStream;
    } catch (err) {
      const errMessage =
        err instanceof Error ? err.message : 'unknown stream error';
      const isAbort =
        signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError');
      // Don't cache failed streams — only successful runs make it to cache.
      yield {
        type: 'done',
        reason: isAbort ? 'aborted' : 'stop',
        error: isAbort ? undefined : errMessage,
      };
      return;
    }

    // Successful stream — persist for replay. Aborted streams are
    // intentionally not cached (the user canceled before completion).
    if (!signal?.aborted) {
      await this.persistChatCache(cacheKey, collected);
      await this.persistConversationTurn(
        conversationId,
        trimmed,
        assistantText,
        relevantNodes.map((n) => n.id),
      );
    }
  }

  /**
   * Internal: persist the current chat turn to the conversation store, if
   * one is configured and a conversationId was supplied. Stores the user
   * turn followed by the assistant turn (with `retrievedNodeIds`).
   * Failures are swallowed — chat is best-effort.
   */
  private async persistConversationTurn(
    conversationId: string | undefined,
    userText: string,
    assistantText: string,
    retrievedNodeIds: string[],
  ): Promise<void> {
    if (!conversationId || !this.conversationStore) return;
    const now = Date.now();
    try {
      await this.conversationStore.appendTurn(conversationId, {
        role: 'user',
        content: userText,
        timestamp: now,
      });
      await this.conversationStore.appendTurn(conversationId, {
        role: 'assistant',
        content: assistantText,
        timestamp: now + 1,
        retrievedNodeIds: retrievedNodeIds.slice(),
      });
    } catch {
      // Conversation persistence failures must never break a chat.
    }
  }

  /**
   * Internal: invoke the provider with structured messages when supported,
   * otherwise fall back to the legacy single-string `stream()`. The legacy
   * path flattens the messages into `<system>\n\nUser: <user>` so older
   * providers still receive both halves.
   */
  private async *invokeProvider(
    provider: LLMProvider,
    messages: LLMMessage[],
    opts: StreamOptions,
  ): AsyncGenerator<LLMStreamEvent, void, unknown> {
    if (typeof provider.streamMessages === 'function') {
      for await (const ev of provider.streamMessages(messages, opts)) {
        yield ev;
      }
      return;
    }
    const flattened = flattenMessages(messages);
    for await (const ev of provider.stream(flattened, opts)) {
      yield ev;
    }
  }

  /**
   * Emit a buffered stream of provider events to the host, applying two
   * engine-side fallbacks the user never sees a model failure for:
   *
   *   1. **Empty-highlight substitution** — when the model emits a
   *      `highlight` whose `ids` are empty, missing, or otherwise unusable
   *      (after the upstream malformed-tool-call retry has already
   *      completed), the engine substitutes the embedding-retrieved node
   *      ids that built the prompt's relevant-nodes catalog. Without this
   *      the host sees `highlight({ids:{}})` and nothing fades / lights —
   *      exactly the failure mode the user reported live against
   *      gpt-5.4-mini ("Tell me about Cain" → empty highlight).
   *
   *   2. **Zero-text synthesis** — when the model finishes the stream
   *      without ever emitting a `text` event (only tool calls), the engine
   *      synthesizes a single grounded acknowledgment derived from the
   *      relevant-nodes catalog. Better than the silent screen the user
   *      reported.
   *
   * Text events stream live as they arrive. Tool calls are buffered so we
   * can decide on the substitute / synth before the `done` event closes
   * the stream. Aborted streams short-circuit immediately.
   */
  private async *emitWithFallbacks(
    events: ReadonlyArray<LLMStreamEvent>,
    emitToolCalls: boolean,
    relevantNodes: ReadonlyArray<NodeData>,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<ChatEvent, void, unknown> {
    // Pure-reducer rewrite (Phase 1 / 0.8.0): single pass over the final
    // attempt's events accumulating the four signals we care about
    // (`textCount`, `eventCount`, `highlightSeen`, `highlightIds`), then a
    // deterministic fallback step. No cross-attempt state — the previous
    // implementation tracked `sawAnyHighlightAttempt` across retries via
    // class-level mutable fields, which raced.
    interface Reduced {
      eventCount: number;
      textCount: number;
      highlightSeen: boolean;
      highlightIds: Set<string>;
      bufferedToolCalls: ChatEvent[];
      doneReason?: 'stop' | 'length' | 'aborted';
      sawDone: boolean;
      textBuffer: string;
    }

    const reduced: Reduced = {
      eventCount: 0,
      textCount: 0,
      highlightSeen: false,
      highlightIds: new Set<string>(),
      bufferedToolCalls: [],
      sawDone: false,
      textBuffer: '',
    };

    for (const ev of events) {
      reduced.eventCount += 1;
      if (signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }
      if (ev.type === 'text') {
        reduced.textCount += 1;
        reduced.textBuffer += ev.delta;
        yield { type: 'text', delta: ev.delta };
        continue;
      }
      if (ev.type === 'done') {
        reduced.doneReason = ev.reason;
        reduced.sawDone = true;
        continue; // walk to end so reducer sees full attempt
      }
      // tool_call.
      const translated = parseToolCall(ev.name, ev.arguments);
      if (translated && translated.type === 'highlight') {
        reduced.highlightSeen = true;
        for (const id of translated.ids) reduced.highlightIds.add(id);
        if (translated.ids.size > 0 && emitToolCalls) {
          reduced.bufferedToolCalls.push(translated);
        }
        continue;
      }
      if (!translated && ev.name === 'highlight') {
        reduced.highlightSeen = true;
        continue;
      }
      if (translated && emitToolCalls) {
        reduced.bufferedToolCalls.push(translated);
      }
    }

    // -- Empty-highlight substitution. Substitute from per-query
    //    retrieval set (NOT from the global store).
    if (reduced.highlightSeen && reduced.highlightIds.size === 0) {
      const substituteIds = new Set<string>();
      for (const node of relevantNodes) substituteIds.add(node.id);
      if (substituteIds.size > 0 && emitToolCalls) {
        reduced.bufferedToolCalls.push({
          type: 'highlight',
          ids: substituteIds,
        });
      }
    }

    // -- Zero-text synthesis. Fire when text-silent AND not aborted.
    //    The synthesized text is grounded in the FIRST retrieved node's
    //    content (first paragraph, capped at 200 chars) — NOT a "Showing
    //    Adam, Eve, ..." catalog roll-up.
    let synthesized = '';
    if (reduced.textCount === 0 && !signal?.aborted) {
      const synth = synthesizeGroundedText(relevantNodes);
      if (synth !== undefined) {
        synthesized = synth;
        yield { type: 'text', delta: synth };
      }
    }

    // -- 0.12.0 deterministic citation injection. When the engine is
    //    configured with `citationKey`, scan the accumulated assistant
    //    text for entity-title occurrences anywhere in the WHOLE store
    //    (not just relevantNodes) and rewrite each into the new
    //    `[[token|matched-text]]` wire. Out-of-rerank-top-K entities
    //    that nonetheless show up in the model's prose (e.g. "Father
    //    of Cain, Abel, and Seth" when only Adam is the rerank focus)
    //    still get cited. The model's text-shape no longer matters —
    //    citations become a guaranteed property of the chat pipeline.
    if (this.citationKey !== undefined && !signal?.aborted) {
      const fullText = reduced.textBuffer + synthesized;
      if (fullText.length > 0) {
        const candidates = this.buildCitationCandidates();
        if (candidates.length > 0) {
          const corrected = injectCitations(fullText, candidates);
          if (corrected !== fullText) {
            yield { type: 'text_replace', text: corrected };
          }
        }
      }
    }

    // Flush buffered tool calls.
    for (const tc of reduced.bufferedToolCalls) {
      if (signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }
      yield tc;
    }

    if (signal?.aborted) {
      yield { type: 'done', reason: 'aborted' };
      return;
    }
    if (reduced.sawDone) {
      yield { type: 'done', reason: reduced.doneReason };
    } else {
      yield { type: 'done', reason: 'stop' };
    }
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
    this.warmupPromise = this.runWarmup(tier).catch((err: unknown) => {
      // Route to the diagnostic surface instead of stderr — the next
      // chat() drains this buffer as a `debug` / `warmup-failed` event.
      this.pendingWarmupFailures.push(
        `ensureEmbeddings failed: ${describeError(err)}`,
      );
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
      const text = embeddingText(node, {
        contentKeys: this.embeddingContentKeys,
      });
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
    } catch (err: unknown) {
      this.pendingWarmupFailures.push(
        `embed batch failed: ${describeError(err)}`,
      );
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
   * Build the structured `messages` array sent to the LLM for `chat()`.
   * The system message holds:
   *   1. The hard "MUST emit text + highlight" contract.
   *   2. The dataset schema (attribute keys and sample values).
   *   3. The relevant-nodes catalog — one line per node, format
   *      `id | title | type | <key=value>...`. The model can copy ids
   *      verbatim into `highlight()` calls without guessing.
   *
   * The user message holds the literal user input, and only that. Mixing
   * instructions into the user role is what caused tool-use-trained
   * models to skip the text under tool-use pressure (instructions
   * delivered as user content are weighted as user input, not directive).
   *
   * Contract: every graph-relevant response MUST emit BOTH a streamed text
   * answer AND a `highlight(ids)` tool call covering every node referenced
   * by the answer (the subject of the question PLUS the objects of the
   * answer). Soft "prefer" wording is forbidden — tool-use-trained models
   * read it as permission to skip the text and emit only a tool call.
   */
  buildChatMessages(
    message: string,
    schema: SchemaSummary,
    relevantNodes: ReadonlyArray<NodeData>,
    opts?: { pronounIds?: ReadonlyArray<string> },
  ): LLMMessage[] {
    const schemaBlock = renderSchemaBlock(schema, this.schemaSampleSize);
    const catalogBlock = renderCatalogBlock(relevantNodes, this.citationKey);
    const contentBlock = renderContentBlock(
      relevantNodes,
      this.chatContentSize,
      this.chatContentMaxTokens,
      this.chatContentBudgetTokens,
    );
    const edgesBlock = this.renderEdgesBlock(relevantNodes);
    const inferredBlock = this.renderInferredEdgesBlock();
    const pronounIds = opts?.pronounIds ?? [];
    const lines: string[] = [
      'You are an assistant embedded inside an interactive graph visualization.',
      'The host application renders the graph and shows your conversational text alongside it. Both halves matter — the text explains, the visual shows.',
      '',
      'Every response that touches the graph MUST emit BOTH:',
      '',
      '  1. Conversational text. Stream a clear, brief prose answer that addresses the user\'s question.',
      '',
      '  2. A `highlight(ids)` tool call listing EVERY node referenced in your answer — including the subject of the question, not only the objects of the answer. Every node that is part of "what the user is asking about" goes into the `ids` list. Other nodes fade automatically.',
      '',
      'If the question has no graph relevance (e.g. "how do I use you?"), reply with text only. Otherwise, never text-only and never tool-call-only.',
      '',
      'Other tools (use them additively to `highlight`, never as a replacement):',
      '',
      '  - `focus(nodeId)` — animate the camera to one anchor node when the question is centered on a single node.',
      '  - `apply_filter(spec)` — restrict visibility. Use ONLY when the user EXPLICITLY asks to filter ("show only X", "hide events"). Do NOT auto-filter on questions about the data — that hides the answer.',
      '  - `annotate(nodeId, text)` — attach a sticky note to a node.',
      '',
      'Examples (placeholders in `<...>` stand in for real ids — copy ids verbatim from the catalog below):',
      '  User asks about a place and the people who occupy it:',
      '  → text: a short answer naming the place and the people.',
      '  → highlight(["<node-id-1>", "<node-id-2>", "<node-id-3>"])  ← all three: the subject of the question plus the objects of the answer.',
      '',
      '  User asks about a single entity:',
      '  → text: a short biography or description.',
      '  → highlight(["<node-id>"])',
      '  → focus("<node-id>")',
      '',
      '  User asks a meta question (e.g. "How do I use this?"):',
      '  → text only — no graph entities involved.',
      '',
      'Dataset schema (attribute keys and a sample of observed values):',
      schemaBlock,
      '',
      'Relevant nodes (use these ids verbatim in `highlight` / `focus` / `annotate`):',
      catalogBlock,
    ];
    if (contentBlock !== undefined) {
      lines.push('');
      lines.push('Relevant entity content:');
      lines.push(contentBlock);
      lines.push('');
      lines.push(
        'Use the entity content above as the source of truth for biographical / descriptive answers. If the content does not cover something, say so rather than inventing facts.',
      );
    }
    if (edgesBlock !== undefined) {
      lines.push('');
      lines.push('Edges (explicit relationships among the relevant entities):');
      lines.push(edgesBlock);
    }
    if (inferredBlock !== undefined) {
      lines.push('');
      lines.push('Inferred relationships (system-generated overlays):');
      lines.push(inferredBlock);
    }
    if (pronounIds.length > 0) {
      lines.push('');
      lines.push('Potentially-referenced entities (from prior turn):');
      lines.push(pronounIds.join(', '));
    }
    lines.push('');
    lines.push('Citations:');
    lines.push('');
    lines.push(
      'Write naturally using each entity\'s name. The engine adds citation links automatically — you do not need to emit `[[id]]` tokens.',
    );
    if (this.citationKey !== undefined) {
      lines.push('');
      lines.push(
        'Note: `highlight()` and `focus()` accept the FIRST column (the canonical id). Use those for tool calls.',
      );
    }
    lines.push('');
    lines.push(
      'Every factual claim must reference an entity from the catalog. If the catalog does not contain the answer, say "I do not have data on that" — do not extrapolate or invent.',
    );

    return [
      { role: 'system', content: lines.join('\n') },
      { role: 'user', content: message },
    ];
  }

  /**
   * 0.12.0 — derive `{ token, title }` pairs for every node in the store.
   * The injector matches titles against the whole store so an entity
   * outside the per-turn rerank top-K (e.g. Seth in a turn focused on
   * Adam) still gets cited when its title appears in the response.
   *
   * Skips nodes missing either a citationKey value (or a usable id
   * fallback) or a display title — those candidates can't produce a
   * meaningful link. Memoized on `store.nodeCount`; the cached array
   * is reused across turns when the graph is stable.
   */
  private buildCitationCandidates(): readonly CitationCandidate[] {
    if (this.citationKey === undefined) return [];
    const nodeCount = this.store.nodeCount;
    if (
      this.citationCandidatesCache !== undefined &&
      this.citationCandidatesCache.nodeCount === nodeCount
    ) {
      return this.citationCandidatesCache.candidates;
    }
    const out: CitationCandidate[] = [];
    for (const node of this.store.getAllNodes()) {
      const attrs = node.attributes ?? {};
      const title = pickTitleAttribute(attrs);
      if (typeof title !== 'string' || title.length === 0) continue;
      const raw = attrs[this.citationKey];
      const token =
        typeof raw === 'string' && raw.length > 0 ? raw : node.id;
      if (typeof token !== 'string' || token.length === 0) continue;
      out.push({ token, title });
    }
    this.citationCandidatesCache = { nodeCount, candidates: out };
    return out;
  }

  /**
   * Render the explicit-edges block: for each pair of nodes in
   * `relevantNodes` connected by a store edge, emit one
   * `<source> —[<type]→ <target>` line. Capped at 30 lines so a dense
   * subgraph doesn't blow the prompt budget. Returns `undefined` when no
   * pair is connected.
   */
  private renderEdgesBlock(
    nodes: ReadonlyArray<NodeData>,
  ): string | undefined {
    if (nodes.length < 2) return undefined;
    const idSet = new Set(nodes.map((n) => n.id));
    const lines: string[] = [];
    const MAX = 30;
    for (const edge of this.store.getAllEdges()) {
      if (!idSet.has(edge.sourceId) || !idSet.has(edge.targetId)) continue;
      const type =
        typeof edge.attributes.type === 'string'
          ? edge.attributes.type
          : 'related_to';
      lines.push(`${edge.sourceId} —[${type}]→ ${edge.targetId}`);
      if (lines.length >= MAX) break;
    }
    return lines.length > 0 ? lines.join('\n') : undefined;
  }

  /**
   * Render the inferred-relationships block: every entry currently
   * persisted in {@link InferredEdgeStore}, formatted with confidence
   * + reasoning. Returns `undefined` when no inferred edges exist or no
   * store is wired.
   */
  private renderInferredEdgesBlock(): string | undefined {
    // Synchronous read of the store wouldn't fit the contract; this
    // method is called from buildChatMessages which is sync, so we cache
    // the most-recent snapshot during chat() instead. For the v1 cut we
    // just inspect the last-known snapshot — see {@link refreshInferredEdgesSnapshot}.
    const snap = this.inferredEdgesSnapshot;
    if (!snap || snap.length === 0) return undefined;
    const MAX = 8;
    const lines: string[] = [];
    for (const e of snap) {
      const conf = e.score.toFixed(2);
      const desc = e.reasoning ?? 'related';
      lines.push(
        `[INFERRED, confidence: ${conf}] ${e.sourceId} —[${e.type}]→ ${e.targetId}: ${desc}`,
      );
      if (lines.length >= MAX) break;
    }
    return lines.join('\n');
  }

  /**
   * Snapshot of inferred edges captured at chat() entry. Sync access from
   * {@link buildChatMessages} would otherwise force the whole call stack
   * async. Refreshed by {@link refreshInferredEdgesSnapshot}.
   */
  private inferredEdgesSnapshot: ReadonlyArray<InferredEdge> | undefined;

  private async refreshInferredEdgesSnapshot(): Promise<void> {
    if (!this.inferredEdgeStore) {
      this.inferredEdgesSnapshot = undefined;
      return;
    }
    try {
      this.inferredEdgesSnapshot = await this.inferredEdgeStore.getAll();
    } catch {
      this.inferredEdgesSnapshot = undefined;
    }
  }

  /**
   * Phase 1 hybrid retrieval (0.8.0). Replaces the old cascade of
   * "semantic → keyword → alphabetical-first-12". Combines three signals:
   *
   *   A. Semantic — `embeddingStore.searchVector(queryEmbedding, top)`
   *      when the store implements it AND the provider can embed.
   *   B. Keyword  — the existing data-layer SearchEngine.
   *   C. 1-hop graph expansion — for each top hit (above ~0.6
   *      similarity), pull neighbors via `store.getNeighborIds(id)`.
   *      Each neighbor gets a `+0.3` graph bonus.
   *
   * Per-node merged score: `semantic*0.6 + keyword*0.3 + graphBonus*0.3`.
   * Sort descending. Take top {@link chatRerankCandidates}. When the
   * merged set is empty, return empty — the engine will emit a
   * `retrieval-empty` debug event. NO alphabetical-first-12 fallback.
   */
  private async runHybridRetrieval(
    message: string,
  ): Promise<{ nodes: NodeData[] }> {
    // Fast path: when the store is small enough to fit in the catalog
    // window, return everything. This is NOT the alphabetical-first-12
    // fallback the Phase 1 spec calls out — that one fired when retrieval
    // missed on a LARGE graph; this one is the legitimate "graph is small,
    // just give the model everything" optimization.
    const all = this.store.getAllNodes();
    if (all.length > 0 && all.length <= this.chatContextSize) {
      return {
        nodes: all.map((n) => ({ id: n.id, attributes: n.attributes })),
      };
    }
    const k = this.chatRerankCandidates;
    const score = new Map<string, number>();

    // A. Semantic via searchVector when the store supports it.
    if (
      this.embeddingStore &&
      typeof (this.embeddingStore as EmbeddingStore).searchVector ===
        'function' &&
      this.providerHasEmbed() &&
      this.provider
    ) {
      try {
        const embedFn = this.provider.embed!.bind(this.provider);
        const [qv] = await embedFn([message]);
        if (qv && qv.length > 0) {
          const hits = await this.embeddingStore.searchVector!(qv, {
            top: k,
            container: 'units',
          });
          for (const h of hits) {
            score.set(h.nodeId, (score.get(h.nodeId) ?? 0) + h.score * 0.6);
          }
        }
      } catch {
        // best-effort: semantic failure must not break retrieval.
      }
    }

    // B. Keyword via the data-layer SearchEngine. The underlying engine
    //    matches the WHOLE query as a substring, which fails on natural-
    //    language inputs like "Tell me about Cain" because no attribute
    //    contains that whole phrase. Tokenize on whitespace and accumulate
    //    per-token hits so each meaningful word contributes; this is the
    //    canonical hybrid-retrieval keyword path.
    const tokens = tokenizeForKeywordSearch(message);
    const keywordRunScore = new Map<string, number>();
    for (const tok of tokens) {
      const hits = this.keywordEngine.search(tok);
      for (const r of hits) {
        keywordRunScore.set(
          r.nodeId,
          (keywordRunScore.get(r.nodeId) ?? 0) + r.score,
        );
      }
    }
    for (const [nodeId, s] of keywordRunScore) {
      score.set(nodeId, (score.get(nodeId) ?? 0) + s * 0.3);
    }

    // C. 1-hop graph expansion: for each top hit above 0.6 (in raw score
    //    units, before weighting), add its neighbors with a +0.3 bonus.
    const seedIds = [...score.entries()]
      .filter(([, s]) => s >= 0.18) // 0.6 * 0.3 (min keyword pass)
      .map(([id]) => id);
    for (const id of seedIds) {
      for (const nid of this.store.getNeighborIds(id)) {
        score.set(nid, (score.get(nid) ?? 0) + 0.3);
      }
    }

    if (score.size === 0) return { nodes: [] };

    const sorted = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id]) => id);
    return { nodes: this.materializeNodes(sorted) };
  }

  /**
   * Phase 1 cross-encoder rerank (0.8.0). For each candidate node, asks
   * the LLM provider to score relevance to the user query. Sorts by score
   * descending, keeps top-K. Cached on
   * `(conversationId, queryHash, candidateIds)` so a follow-up turn with
   * the same retrieval doesn't re-pay the LLM bill.
   */
  private async runRerank(
    message: string,
    candidates: ReadonlyArray<NodeData>,
    conversationId: string | undefined,
  ): Promise<NodeData[]> {
    if (candidates.length === 0) return [];
    if (!this.provider) return candidates.slice();
    const idsKey = candidates
      .map((n) => n.id)
      .sort()
      .join(',');
    const queryHash = fnv1a64(message);
    const cacheKey = `rerank|${conversationId ?? ''}|${queryHash}|${idsKey}`;
    const cached = this.rerankCache.get(cacheKey);
    if (cached) {
      // Reorder candidates to the cached order, dropping any that are
      // no longer in the candidate set.
      const byId = new Map(candidates.map((n) => [n.id, n]));
      const out: NodeData[] = [];
      for (const id of cached) {
        const n = byId.get(id);
        if (n) out.push(n);
      }
      return out;
    }

    const provider = this.provider;
    const completeFn = provider.complete.bind(provider);
    const scored = await Promise.all(
      candidates.map(async (n) => {
        const title = pickTitleAttribute(n.attributes ?? {}) ?? n.id;
        const summary = renderShortSummary(n);
        const prompt =
          `Score 0.0-1.0 how relevant this node is to the user's question. ` +
          `Return JSON only: {"score": number, "reason": string}.\n` +
          `User question: ${message}\n` +
          `Node id: ${n.id}\n` +
          `Title: ${title}\n` +
          `Summary: ${summary}`;
        let raw = '';
        try {
          raw = await completeFn(prompt, { format: 'json' });
        } catch {
          raw = '';
        }
        return { node: n, score: parseScoreJson(raw) };
      }),
    );

    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, this.chatRerankTopK).map((s) => s.node);
    this.rerankCache.set(
      cacheKey,
      kept.map((n) => n.id),
    );
    return kept;
  }

  /** Internal: lift a list of node ids to the {@link NodeData} shape, dropping unknowns. */
  private materializeNodes(ids: ReadonlyArray<string>): NodeData[] {
    const out: NodeData[] = [];
    for (const id of ids) {
      const node = this.store.getNode(id);
      if (!node) continue;
      out.push({ id: node.id, attributes: node.attributes });
    }
    return out;
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
 * recognize our entries vs other consumer-owned cache slots, and the
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
 * Cache key for a chat messages array + tool definition list. Tool
 * definitions are folded into the hash so changing the tool surface
 * invalidates cached responses; the messages array is hashed in stable
 * (role, content) order so a system-message edit also invalidates.
 */
function chatCacheKey(
  messages: LLMMessage[],
  tools: LLMToolDefinition[],
): string {
  const messageSig = messages
    .map((m) => `${m.role}:${m.content}`)
    .join(' ');
  const toolSig = tools
    .map((t) => `${t.name}:${stableStringify(t.parameters)}`)
    .join('|');
  return `chat|${fnv1a64(messageSig)}|${fnv1a64(toolSig)}`;
}

/**
 * Flatten a structured-messages array into a single prompt string, used by
 * the legacy `stream()` fallback when the provider doesn't implement
 * {@link LLMProvider.streamMessages}. Format is
 *   `<system content>\n\nUser: <user content>` (with assistant turns
 * interleaved as `Assistant: ...` blocks). Per the project memory, this is
 * a backwards-compatibility bridge — the structured path is preferred.
 */
function flattenMessages(messages: LLMMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') parts.push(m.content);
    else if (m.role === 'user') parts.push(`User: ${m.content}`);
    else parts.push(`Assistant: ${m.content}`);
  }
  return parts.join('\n\n');
}

/**
 * Render the catalog block embedded in the chat system message. Format:
 *
 *   `<id> | <title> | <type> | <key>=<value>; <key>=<value>...`
 *
 * One line per node. The title is taken from `name`/`title`/`label` (in that
 * order); `<type>` is the `type` attribute or the literal `(unknown)`. Other
 * attributes follow as `key=value` pairs, alphabetized, with array values
 * joined by `,`. Empty input yields `(no nodes)` so the prompt never has a
 * blank section.
 *
 * When `citationKey` is provided, each row gains a trailing column carrying
 * the value of `node.attributes[citationKey]` (or `node.id` if that
 * attribute is missing/non-string). The system prompt's citation rule
 * points the model at this LAST column for `[[...]]` tokens, decoupling
 * the human-friendly citation token from the canonical (often UUID) id
 * used by tool calls.
 */
function renderCatalogBlock(
  nodes: ReadonlyArray<NodeData>,
  citationKey: string | undefined,
): string {
  if (nodes.length === 0) return '(no nodes)';
  const lines: string[] = [];
  for (const node of nodes) {
    const attrs = node.attributes ?? {};
    const title = pickTitleAttribute(attrs) ?? node.id;
    const type = typeof attrs.type === 'string' ? attrs.type : '(unknown)';
    const extras: string[] = [];
    const keys = Object.keys(attrs).sort();
    for (const key of keys) {
      if (
        key === 'name' ||
        key === 'title' ||
        key === 'label' ||
        key === 'type'
      ) {
        continue;
      }
      const rendered = renderAttrValue(attrs[key]);
      if (rendered === undefined) continue;
      extras.push(`${key}=${rendered}`);
    }
    const extrasJoined = extras.length > 0 ? ` | ${extras.join('; ')}` : '';
    const baseRow = `${node.id} | ${title} | ${type}${extrasJoined}`;
    if (citationKey !== undefined) {
      const raw = attrs[citationKey];
      const citationValue =
        typeof raw === 'string' && raw.length > 0 ? raw : node.id;
      lines.push(`${baseRow} | ${citationValue}`);
    } else {
      lines.push(baseRow);
    }
  }
  return lines.join('\n');
}

/**
 * Render the optional "Relevant entity content:" block. Walks the same
 * relevance-ranked node list the catalog uses, takes the top
 * `contentSize` nodes whose `attributes.content` is a non-empty string,
 * truncates each body to `maxPerNode` bytes (appending `…` when cut),
 * then enforces the total `budget` by dropping lowest-relevance
 * content first. Returns `undefined` when no node has content — the
 * caller then omits the section entirely so hosts that don't store
 * content see a clean prompt.
 */
function renderContentBlock(
  nodes: ReadonlyArray<NodeData>,
  contentSize: number,
  maxPerNode: number,
  budget: number,
): string | undefined {
  // Take the top-K candidates from the (already-ranked) node list. If the
  // list is shorter than K we use what we have — never pad.
  const candidates = nodes
    .slice(0, Math.max(0, contentSize))
    .map((node) => {
      const attrs = node.attributes ?? {};
      const raw = attrs.content;
      if (typeof raw !== 'string' || raw.length === 0) return undefined;
      const title = pickTitleAttribute(attrs) ?? node.id;
      const truncated =
        raw.length > maxPerNode ? raw.slice(0, maxPerNode) + '…' : raw;
      return { id: node.id, title, body: truncated };
    })
    .filter(
      (entry): entry is { id: string; title: string; body: string } =>
        entry !== undefined,
    );

  if (candidates.length === 0) return undefined;

  // Render each candidate to a `## title (id: id)\nbody` block, then walk
  // from highest to lowest relevance keeping a running byte count. The
  // first block to push the total past `budget` (and every block after it)
  // is dropped.
  const rendered: Array<{ block: string; bytes: number }> = candidates.map(
    (c) => {
      const block = `## ${c.title} (id: ${c.id})\n${c.body}`;
      return { block, bytes: block.length };
    },
  );
  const kept: string[] = [];
  let total = 0;
  for (const r of rendered) {
    if (total + r.bytes > budget && kept.length > 0) break;
    kept.push(r.block);
    total += r.bytes;
  }
  return kept.join('\n\n');
}

/**
 * Phase 1 zero-text synthesis: derive a single grounded text event from
 * the FIRST retrieved node's content body (first paragraph, capped at
 * 200 chars). Never falls back to the catalog roll-up. Returns
 * `undefined` when there's nothing to ground in.
 */
function synthesizeGroundedText(
  nodes: ReadonlyArray<NodeData>,
): string | undefined {
  if (nodes.length === 0) return undefined;
  const first = nodes[0];
  const attrs = first.attributes ?? {};
  const title = pickTitleAttribute(attrs) ?? first.id;
  const contentKeys = ['content', 'description', 'body', 'summary'];
  let body = '';
  for (const k of contentKeys) {
    const v = attrs[k];
    if (typeof v === 'string' && v.length > 0) {
      body = v;
      break;
    }
  }
  if (body.length === 0) {
    // No body text — narrate the node minimally with its title so the host
    // always renders SOMETHING. This is grounded in the node id, not in a
    // multi-entity catalog list.
    return `${title}.`;
  }
  // First paragraph, capped at 200 chars.
  const firstPara = body.split(/\n\s*\n/)[0] ?? body;
  const truncated =
    firstPara.length > 200 ? firstPara.slice(0, 200) + '…' : firstPara;
  return truncated;
}

/**
 * Tokenize a chat message into keyword-search candidate tokens. Drops
 * stopwords + tokens shorter than three chars so the keyword path doesn't
 * get drowned in matches against "the" / "of" / etc.
 */
function tokenizeForKeywordSearch(message: string): string[] {
  const STOPWORDS = new Set([
    'the',
    'and',
    'for',
    'are',
    'but',
    'not',
    'you',
    'all',
    'can',
    'her',
    'was',
    'one',
    'our',
    'out',
    'day',
    'get',
    'has',
    'him',
    'his',
    'how',
    'man',
    'new',
    'now',
    'old',
    'see',
    'two',
    'way',
    'who',
    'boy',
    'did',
    'its',
    'let',
    'put',
    'say',
    'she',
    'too',
    'use',
    'tell',
    'about',
    'what',
    'who',
    'when',
    'where',
    'why',
    'with',
    'this',
    'that',
    'they',
    'them',
    'from',
    'into',
    'have',
    'been',
    'will',
    'were',
    'your',
  ]);
  const tokens = message.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Detect whether a message contains a pronoun the model may need help resolving. */
function hasPronouns(message: string): boolean {
  const PRONOUNS = [
    'he',
    'she',
    'him',
    'her',
    'it',
    'they',
    'them',
    'this',
    'that',
    'his',
    'hers',
    'its',
    'their',
  ];
  const tokens = message.toLowerCase().split(/[^a-z]+/);
  for (const t of tokens) {
    if (PRONOUNS.includes(t)) return true;
  }
  return false;
}

/**
 * Parse the JSON envelope used by the rerank prompt. Tolerates surrounding
 * markdown fences (some providers emit them despite `format: 'json'`).
 * Clamps to `[0, 1]`. Returns 0 on any malformed payload so the candidate
 * sinks to the bottom rather than crashing the rerank.
 */
function parseScoreJson(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return 0;
  }
  if (!parsed || typeof parsed !== 'object') return 0;
  const score = (parsed as { score?: unknown }).score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

function pickTitleAttribute(
  attrs: Record<string, unknown>,
): string | undefined {
  for (const key of ['name', 'title', 'label']) {
    const v = attrs[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Short summary for the rerank prompt — `id: <id>` plus the first 200
 * characters of any content/description body. Keeps the rerank prompt
 * small while giving the model enough to score against.
 */
function renderShortSummary(node: NodeData): string {
  const attrs = node.attributes ?? {};
  const contentKeys = ['content', 'description', 'body', 'summary'];
  for (const k of contentKeys) {
    const v = attrs[k];
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 200 ? v.slice(0, 200) + '…' : v;
    }
  }
  return `id: ${node.id}`;
}

function renderAttrValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0) parts.push(item);
      else if (typeof item === 'number' || typeof item === 'boolean') parts.push(String(item));
    }
    return parts.length > 0 ? parts.join(',') : undefined;
  }
  return undefined;
}

/**
 * Validate a raw tool-call payload against the engine's known tool schemas.
 * Returns `{ ok: true }` for accept, `{ ok: false, reason }` for reject.
 *
 * The engine keeps a hand-rolled validator (rather than pulling a JSON-Schema
 * runtime) because the rule set is small and bounded by {@link BUILT_IN_TOOLS}.
 * Rules: required fields present, array fields are arrays (NOT objects),
 * string fields are strings, boolean fields are booleans.
 */
function validateToolArgs(
  name: string,
  argsJson: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { ok: false, reason: 'arguments are not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'arguments must be a JSON object' };
  }
  const a = parsed as Record<string, unknown>;
  switch (name) {
    case 'highlight': {
      if (!('ids' in a)) {
        return { ok: false, reason: 'missing required field "ids"' };
      }
      if (!Array.isArray(a.ids)) {
        return {
          ok: false,
          reason: '"ids" must be an array of strings, not an object or other type',
        };
      }
      return { ok: true };
    }
    case 'focus': {
      if (typeof a.nodeId !== 'string' || a.nodeId.length === 0) {
        return { ok: false, reason: '"nodeId" must be a non-empty string' };
      }
      return { ok: true };
    }
    case 'annotate': {
      if (typeof a.nodeId !== 'string' || a.nodeId.length === 0) {
        return { ok: false, reason: '"nodeId" must be a non-empty string' };
      }
      if (typeof a.text !== 'string') {
        return { ok: false, reason: '"text" must be a string' };
      }
      return { ok: true };
    }
    case 'apply_filter': {
      // Either { spec: {...} } or the spec inlined. Both are accepted by
      // parseToolCall, so we mirror that leniency here.
      const candidate =
        a.spec && typeof a.spec === 'object' && !Array.isArray(a.spec)
          ? (a.spec as Record<string, unknown>)
          : a;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return { ok: false, reason: '"spec" must be an object' };
      }
      return { ok: true };
    }
    case 'set_inferred_visibility': {
      if (typeof a.visible !== 'boolean') {
        return { ok: false, reason: '"visible" must be a boolean' };
      }
      return { ok: true };
    }
    default:
      // Unknown tool — let translateLLMEvent drop it; no retry.
      return { ok: true };
  }
}

/**
 * Append a corrective system message (and the prior assistant tool-call
 * attempt) so the model can see WHAT went wrong on retry. Includes the
 * available node ids so the model has fresh context for a corrected
 * `highlight` call.
 */
function appendCorrectionForRetry(
  messages: LLMMessage[],
  badEvent: Extract<LLMStreamEvent, { type: 'tool_call' }>,
  reason: string,
  relevantNodes: ReadonlyArray<NodeData>,
): LLMMessage[] {
  const idsList = relevantNodes
    .map((n) => n.id)
    .slice(0, 32)
    .join(', ');
  const next = messages.slice();
  next.push({
    role: 'assistant',
    content: `[tool_call ${badEvent.name} ${badEvent.arguments}]`,
  });
  next.push({
    role: 'system',
    content:
      `The previous tool call \`${badEvent.name}\` had invalid arguments: ${reason}. ` +
      `The available node ids are: ${idsList}. ` +
      `Emit a corrected tool call alongside your text answer.`,
  });
  return next;
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
 * Coerce an unknown thrown value into a short human-readable string for
 * the diagnostic surface (`ChatEvent.debug.detail`). Prefers `Error.message`,
 * falls back to `String(err)`, and tolerates non-Error throws.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
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

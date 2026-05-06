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
    this.chatContextSize = config?.chatContextSize ?? 12;
    this.chatContentSize = config?.chatContentSize ?? 4;
    this.chatContentMaxTokens = config?.chatContentMaxTokens ?? 800;
    this.chatContentBudgetTokens = config?.chatContentBudgetTokens ?? 3200;
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
    const relevantNodes = await this.collectRelevantNodes(trimmed);
    const messages = this.buildChatMessages(trimmed, schema, relevantNodes);
    const tools = BUILT_IN_TOOLS;

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
    const bufferedToolCalls: ChatEvent[] = [];
    let textCount = 0;
    let sawNonEmptyHighlight = false;
    let sawAnyHighlightAttempt = false;
    let doneEvent: Extract<LLMStreamEvent, { type: 'done' }> | undefined;
    let sawDone = false;

    for (const ev of events) {
      if (signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }
      if (ev.type === 'text') {
        textCount += 1;
        yield { type: 'text', delta: ev.delta };
        continue;
      }
      if (ev.type === 'done') {
        doneEvent = ev;
        sawDone = true;
        break;
      }
      // tool_call — translate and decide whether to buffer or hold for
      // substitution.
      const translated = parseToolCall(ev.name, ev.arguments);
      if (translated && translated.type === 'highlight') {
        sawAnyHighlightAttempt = true;
        if (translated.ids.size > 0) {
          sawNonEmptyHighlight = true;
          if (emitToolCalls) bufferedToolCalls.push(translated);
        }
        // Empty highlight: deliberately drop here so the substitute can
        // take its place after the buffered tool calls.
        continue;
      }
      // Non-highlight tool call. The model may have called highlight with
      // a malformed shape that parseToolCall rejected (e.g. ids: {}); the
      // upstream retry handles validation, so anything reaching us is
      // genuinely a translation failure for this tool. We track the
      // attempt regardless so substitution still kicks in.
      if (!translated && ev.name === 'highlight') {
        sawAnyHighlightAttempt = true;
        continue;
      }
      if (translated && emitToolCalls) {
        bufferedToolCalls.push(translated);
      }
    }

    // Empty-highlight substitution. We substitute when the model attempted
    // a highlight at all but never produced one with ids. This covers the
    // observed `highlight({"ids":{}})` failure mode AND the live
    // `highlight({})` no-`ids`-key one. We do not synthesize a highlight
    // when the model never tried — that would imply graph relevance we
    // can't be sure of.
    if (sawAnyHighlightAttempt && !sawNonEmptyHighlight) {
      const substituteIds = new Set<string>();
      for (const node of relevantNodes) substituteIds.add(node.id);
      if (substituteIds.size > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[chat] model emitted empty highlight; substituting ${substituteIds.size} embedding-retrieved ids`,
        );
        if (emitToolCalls) {
          bufferedToolCalls.push({ type: 'highlight', ids: substituteIds });
        }
      }
    }

    // Zero-text synthesis. Fire when the model produced no text deltas
    // AND we are not in an aborted state. The synthesized acknowledgment
    // is a brief grounded line built from the relevant-nodes catalog so
    // the host always renders something — better than the empty pane the
    // user reported.
    if (textCount === 0 && !signal?.aborted) {
      const synth = synthesizeAcknowledgment(relevantNodes);
      if (synth !== undefined) {
        // eslint-disable-next-line no-console
        console.warn('[chat] model emitted no text; synthesized acknowledgment');
        yield { type: 'text', delta: synth };
      }
    }

    // Flush buffered tool calls now that any synth text has gone first.
    for (const tc of bufferedToolCalls) {
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
    if (sawDone && doneEvent) {
      yield { type: 'done', reason: doneEvent.reason };
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
  ): LLMMessage[] {
    const schemaBlock = renderSchemaBlock(schema, this.schemaSampleSize);
    const catalogBlock = renderCatalogBlock(relevantNodes);
    const contentBlock = renderContentBlock(
      relevantNodes,
      this.chatContentSize,
      this.chatContentMaxTokens,
      this.chatContentBudgetTokens,
    );
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
      'Examples:',
      '  User: "Who lived in Eden?"',
      '  → text: "Adam and Eve dwelt in the Garden of Eden."',
      '  → highlight(["garden-of-eden", "adam", "eve"])  ← all three: the place asked about plus the people who lived there.',
      '',
      '  User: "Tell me about Noah."',
      '  → text: a short biography',
      '  → highlight(["noah"])',
      '  → focus("noah")',
      '',
      '  User: "How do I use this?"',
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

    return [
      { role: 'system', content: lines.join('\n') },
      { role: 'user', content: message },
    ];
  }

  /**
   * Internal: pick the slice of nodes most relevant to the user's message
   * for the chat catalog. Three paths:
   *   - Graph fits in {@link chatContextSize} → return the full catalog.
   *   - Embeddings warm + provider has `embed` → semantic top-K.
   *   - Otherwise → keyword search (always available).
   *
   * The semantic path never blocks on a cold-start warmup — when no
   * embeddings are available yet we fall through to keyword so chat
   * doesn't hang.
   */
  private async collectRelevantNodes(
    message: string,
  ): Promise<NodeData[]> {
    const all = this.store.getAllNodes();
    const k = this.chatContextSize;
    if (all.length <= k) {
      return all.map((n) => ({ id: n.id, attributes: n.attributes }));
    }

    // Semantic path — only if embeddings are wired AND the provider can embed.
    const tier = this.getEmbeddingTier();
    if (tier !== 'tier-1') {
      const haveAnyEmbedding = await this.hasAnyEmbedding();
      if (haveAnyEmbedding) {
        try {
          const hits = await this.runSemanticSearch(message, k, undefined);
          if (hits.length > 0) {
            return this.materializeNodes(hits.map((h) => h.nodeId));
          }
        } catch {
          // fall through to keyword
        }
      }
    }

    // Keyword fallback — always available.
    const keywordHits = this.keywordEngine.search(message);
    if (keywordHits.length === 0) {
      // No matches — give the model a head-truncated catalog rather than
      // nothing so it still has SOME ids to refer to.
      return all
        .slice(0, k)
        .map((n) => ({ id: n.id, attributes: n.attributes }));
    }
    return this.materializeNodes(keywordHits.slice(0, k).map((h) => h.nodeId));
  }

  /** Internal: cheap "do we have ANY embedding warm yet?" check used by the
   *  catalog selector to decide whether to attempt a semantic top-K. */
  private async hasAnyEmbedding(): Promise<boolean> {
    if (this.embeddingStore) {
      // No general "size" primitive on the store contract — best effort: ask
      // for a similar() with a zero-vector and see if anything comes back.
      try {
        const probe = await this.embeddingStore.similar([], 1, '', '');
        return probe.length > 0;
      } catch {
        return false;
      }
    }
    if (this.cache) {
      try {
        const raw = await this.cache.get(EMBED_INDEX_KEY);
        if (!raw) return false;
        const list = JSON.parse(raw) as string[];
        return Array.isArray(list) && list.length > 0;
      } catch {
        return false;
      }
    }
    return false;
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
 */
function renderCatalogBlock(nodes: ReadonlyArray<NodeData>): string {
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
    lines.push(`${node.id} | ${title} | ${type}${extrasJoined}`);
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
 * Build the one-line text the engine yields when the model finished a
 * chat turn without ever emitting a `text` event. We prefer titles over
 * raw ids so the acknowledgment reads naturally; if no title attribute
 * exists we fall back to the entity count. Returns `undefined` when no
 * relevant nodes were available — the caller then skips the synth so we
 * never emit literally `Showing .` or `Found 0 relevant entities ...`.
 */
function synthesizeAcknowledgment(
  nodes: ReadonlyArray<NodeData>,
): string | undefined {
  if (nodes.length === 0) return undefined;
  const titles: string[] = [];
  const MAX_TITLES = 6;
  for (const node of nodes) {
    const t = pickTitleAttribute(node.attributes ?? {});
    if (t !== undefined) titles.push(t);
    if (titles.length >= MAX_TITLES) break;
  }
  if (titles.length > 0) return `Showing ${titles.join(', ')}.`;
  return `Found ${nodes.length} relevant entities for your question.`;
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

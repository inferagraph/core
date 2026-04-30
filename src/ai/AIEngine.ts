import type { NodeData } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import type { CacheProvider } from '../cache/lruCache.js';
import type {
  CompleteOptions,
  LLMProvider,
  LLMStreamEvent,
  LLMToolDefinition,
} from './LLMProvider.js';
import type { ChatEvent, ChatOptions, FilterSpec } from './ChatEvent.js';

/**
 * Tunables for the AI engine. Phase 1 deliberately keeps this small — chat,
 * search, highlight, embeddings, drilldown all land in later phases.
 */
export interface AIEngineConfig {
  /**
   * Maximum number of distinct values to include per attribute when describing
   * the dataset schema to the LLM. Keeps token usage bounded on large graphs.
   * Default: 10. Phase 3 replaces this lightweight discovery with a richer
   * schema engine; consumers shouldn't depend on the exact prompt shape.
   */
  schemaSampleSize?: number;
}

/**
 * Locked Phase 2 tool definitions. The same names + parameter shapes are
 * used by the prompt builder, the JSON-Schema sent to the LLM provider,
 * the cache-key hash, and the chat-event parser. Changing this list
 * requires Phase 2B (provider package) coordination.
 */
const PHASE2_TOOLS: LLMToolDefinition[] = [
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
  private provider: LLMProvider | undefined;
  private cache: CacheProvider | undefined;
  /**
   * Reference identity of the last provider seen by any cached operation.
   * Per the user's design choice, switching the provider instance triggers a
   * `cache.clear()` so responses from the prior model don't bleed across.
   */
  private lastProvider: LLMProvider | undefined;

  constructor(
    store: GraphStore,
    _queryEngine: QueryEngine,
    config?: AIEngineConfig,
  ) {
    this.store = store;
    this.schemaSampleSize = config?.schemaSampleSize ?? 10;
  }

  /** Inject (or replace) the LLM provider. Triggers cache wipe if it changes. */
  setProvider(provider: LLMProvider | undefined): void {
    this.provider = provider;
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
  }

  /** Get the current cache, or `undefined` if caching is disabled. */
  getCache(): CacheProvider | undefined {
    return this.cache;
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
    const tools = PHASE2_TOOLS;

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
   * Internal: a tiny schema-discovery pass. Phase 3 replaces this with a real
   * schema engine (with cardinality, type inference, value frequency, etc.).
   * For Phase 1 we only need enough to teach the LLM which attribute keys exist.
   */
  private discoverSchema(): SchemaSummary {
    const schema = new Map<string, Set<string>>();
    const nodes = this.store.getAllNodes();
    for (const node of nodes) {
      for (const [key, value] of Object.entries(node.attributes)) {
        let bucket = schema.get(key);
        if (!bucket) {
          bucket = new Set();
          schema.set(key, bucket);
        }
        if (bucket.size >= this.schemaSampleSize) continue;
        for (const sample of summarizeValue(value)) {
          if (bucket.size >= this.schemaSampleSize) break;
          bucket.add(sample);
        }
      }
    }
    return schema;
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

function summarizeValue(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') out.push(item);
      else if (typeof item === 'number' || typeof item === 'boolean') out.push(String(item));
    }
    return out;
  }
  return [];
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

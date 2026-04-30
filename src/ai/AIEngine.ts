import type { NodeData } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import type { CacheProvider } from '../cache/lruCache.js';
import type { CompleteOptions, LLMProvider } from './LLMProvider.js';

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
 * The InferaGraph AI engine. Owns the LLM provider + (optional) response cache
 * and exposes high-level operations the React layer routes user actions through.
 *
 * Phase 1 surface:
 *   - `setProvider` / `setCache` — wired by the `<InferaGraph llm cache>` props.
 *   - `compileFilter(nlq)` — natural-language query → predicate the renderer accepts.
 *
 * The engine is host-blind by contract: hosts never invoke it directly. The
 * React layer pushes provider/cache/query into it; tool-calls and chat events
 * (Phase 2) flow back out through callbacks the React layer subscribes to.
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

    const filterSpec = this.parseFilterSpec(raw);
    if (!filterSpec) return () => true;

    return buildPredicateFromSpec(filterSpec);
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
    const schemaLines: string[] = [];
    for (const [key, values] of schema) {
      const samples = [...values].slice(0, this.schemaSampleSize);
      schemaLines.push(`- ${key}: ${samples.join(', ')}`);
    }
    const schemaBlock = schemaLines.length > 0 ? schemaLines.join('\n') : '(no attributes)';

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
   * Parse the LLM's response as a `FilterSpec`. Returns `undefined` on any
   * malformed input (logged as a warning). We strip optional Markdown fencing
   * because some models add `\`\`\`json` despite instructions.
   */
  private parseFilterSpec(raw: string): FilterSpec | undefined {
    if (!raw) return undefined;
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[InferaGraph AIEngine] failed to parse LLM filter JSON:', err, raw);
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type SchemaSummary = Map<string, Set<string>>;

interface FilterSpec {
  [attributeKey: string]: string[];
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
 * Build a node predicate from a parsed filter spec. A node matches when, for
 * every (key, allowedValues) pair in the spec, the node's attribute value (or
 * any element of an array attribute) is contained in `allowedValues`. An empty
 * spec matches every node.
 */
function buildPredicateFromSpec(spec: FilterSpec): (node: NodeData) => boolean {
  const entries = Object.entries(spec);
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

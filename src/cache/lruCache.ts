import { parseTTL } from './parseTTL.js';

/**
 * Pluggable cache backend for LLM responses inside `@inferagraph/core`.
 *
 * Implementations are responsible for enforcing their own bounds (entry count,
 * TTL, memory ceiling, etc.). Consumers do NOT pass per-entry TTLs — the cache
 * is configured once at construction and applies its policy uniformly.
 *
 * The shape is intentionally tiny: `get` / `set` / `clear`. That's enough for
 * the AI engine's needs and lets external implementations (Redis, IndexedDB,
 * etc.) target a stable contract.
 */
export interface CacheProvider {
  /** Look up a value by key. Returns `undefined` on miss. */
  get(key: string): Promise<string | undefined>;
  /** Store a value. Cache enforces its own bounds; consumers don't pass per-entry TTLs. */
  set(key: string, value: string): Promise<void>;
  /** Drop everything. Called by `AIEngine` when the LLM provider instance changes. */
  clear(): Promise<void>;
}

/**
 * Configuration for the built-in {@link lruCache} implementation.
 *
 * Defaults are applied jointly:
 * - When BOTH `maxEntries` and `ttl` are unset → `maxEntries: 500, ttl: '24h'`.
 * - When ONLY `maxEntries` is set → `ttl` is treated as no-limit.
 * - When ONLY `ttl` is set → `maxEntries` is treated as no-limit.
 * - When BOTH are set → both bounds enforced; an entry is evicted whichever
 *   bound it crosses first.
 *
 * Pass `-1` (number) or `'-1'` (string, for `ttl`) to explicitly disable a bound.
 */
export interface CacheConfig {
  /** Maximum entries to retain. See class docs for default behavior. -1 = no limit. */
  maxEntries?: number;
  /**
   * Time-to-live per entry. A number (milliseconds) or a duration string with
   * a unit suffix: `5m`, `2h`, `7d`, `1w` (case-insensitive). -1 / `'-1'` = no limit.
   */
  ttl?: number | string;
}

interface Entry {
  value: string;
  /** Wall-clock expiry timestamp (ms since epoch). `Infinity` = no expiry. */
  expiresAt: number;
}

/** Internal in-memory LRU+TTL implementation backing {@link lruCache}. */
class InMemoryLRUCache implements CacheProvider {
  private readonly maxEntries: number; // -1 == no limit
  private readonly ttlMs: number; // -1 == no limit
  private readonly map = new Map<string, Entry>();

  constructor(config: CacheConfig | undefined) {
    const hasMaxEntries = config?.maxEntries !== undefined;
    const hasTtl = config?.ttl !== undefined;

    if (!hasMaxEntries && !hasTtl) {
      // Both unset → friendly default for cost control.
      this.maxEntries = 500;
      this.ttlMs = parseTTL('24h');
    } else {
      this.maxEntries = hasMaxEntries ? this.normalizeMaxEntries(config!.maxEntries!) : -1;
      this.ttlMs = hasTtl ? parseTTL(config!.ttl!) : -1;
    }
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt !== Infinity && Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Re-insert to move this key to the MRU end. Map preserves insertion order
    // in JS, so deleting + re-setting is the canonical LRU "touch" idiom.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: string): Promise<void> {
    const expiresAt = this.ttlMs === -1 ? Infinity : Date.now() + this.ttlMs;

    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, { value, expiresAt });

    if (this.maxEntries !== -1) {
      while (this.map.size > this.maxEntries) {
        // Map iteration order is insertion order; first key is the LRU.
        const oldestKey = this.map.keys().next().value;
        if (oldestKey === undefined) break;
        this.map.delete(oldestKey);
      }
    }
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  private normalizeMaxEntries(value: number): number {
    if (value === -1) return -1;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new Error(
        `lruCache: invalid maxEntries ${value}; expected a non-negative integer or -1`,
      );
    }
    return value;
  }
}

/**
 * Built-in default in-memory LRU+TTL cache for `@inferagraph/core`.
 *
 * Pass an instance to `<InferaGraph cache={lruCache()} />` (or to
 * `AIEngine.setCache`) to memoize LLM responses across renders. For production
 * deployments that need persistence across browser reloads or sharing across
 * users, plug in a different `CacheProvider` (e.g. `@inferagraph/redis-cache-provider`).
 */
export function lruCache(config?: CacheConfig): CacheProvider {
  return new InMemoryLRUCache(config);
}

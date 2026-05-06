import type { CacheProvider } from './lruCache.js';

// Re-export the formal `CacheProvider` interface from the same place
// the in-memory + lru providers live. Consumers can import either:
//   import type { CacheProvider } from '@inferagraph/core';
// or:
//   import { inMemoryCacheProvider, type CacheProvider } from '@inferagraph/core';
export type { CacheProvider };

/**
 * Configuration for {@link inMemoryCacheProvider} / {@link InMemoryCacheProvider}.
 */
export interface InMemoryCacheProviderConfig {
  /**
   * Default TTL (seconds) applied to every `set` that does NOT pass a
   * per-call override. When omitted, entries never expire by default —
   * only the per-call `set(..., { ttlSeconds })` override can introduce
   * expiry.
   */
  ttlSeconds?: number;
}

interface CacheEntry {
  value: string;
  /** Epoch milliseconds; `undefined` means the entry never expires. */
  expiresAt?: number;
}

/**
 * Map-backed cache with optional, opt-in TTL and NO size eviction.
 *
 * Suited to tests and short-lived dev workflows where deterministic
 * behavior trumps memory bounds — every `set` lands, every later `get`
 * returns it (until its TTL elapses, if any), `delete` drops one entry,
 * and `clear` empties the map. For production deployments use
 * {@link lruCache} (built-in LRU+TTL) or `@inferagraph/redis-cache-provider`
 * for persistence + cross-process sharing.
 *
 * TTL is opt-in. By default entries persist indefinitely. Pass
 * `inMemoryCacheProvider({ ttlSeconds: 30 })` to apply a default TTL to
 * every `set`, and/or pass `cache.set(key, value, { ttlSeconds: 5 })` to
 * override the default for a specific entry. Expiry is lazy — entries are
 * dropped on the next `get` after their `expiresAt`, not via a timer.
 *
 * Implements the {@link CacheProvider} contract, so the AI engine wires
 * it via `engine.setCache(inMemoryCacheProvider())`.
 */
export class InMemoryCacheProvider implements CacheProvider {
  private readonly map = new Map<string, CacheEntry>();
  private readonly defaultTtlSeconds: number | undefined;

  constructor(config?: InMemoryCacheProviderConfig) {
    this.defaultTtlSeconds = config?.ttlSeconds;
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      // Lazy expiry: drop the stale entry so subsequent gets stay O(1).
      this.map.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async set(
    key: string,
    value: string,
    opts?: { ttlSeconds?: number },
  ): Promise<void> {
    const ttlSeconds = opts?.ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt =
      ttlSeconds === undefined ? undefined : Date.now() + ttlSeconds * 1000;
    this.map.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

/**
 * Factory for {@link InMemoryCacheProvider} — the canonical way to
 * construct one. Returns the {@link CacheProvider} interface so callers
 * don't accidentally couple to the class shape.
 */
export function inMemoryCacheProvider(
  config?: InMemoryCacheProviderConfig,
): CacheProvider {
  return new InMemoryCacheProvider(config);
}

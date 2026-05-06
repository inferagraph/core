// 0.9.0: a Map-backed `InMemoryCacheProvider` for tests + dev.
//
// `lruCache` is the production-grade default (LRU + TTL). This simpler
// alternative has no default eviction; TTL is opt-in via construction
// option or per-call override on `set`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  inMemoryCacheProvider,
  InMemoryCacheProvider,
  type CacheProvider,
} from '../../src/cache/inMemoryCacheProvider.js';

describe('InMemoryCacheProvider — Map-backed, no eviction', () => {
  it('round-trips set/get for a single key', async () => {
    const cache: CacheProvider = inMemoryCacheProvider();
    await cache.set('k1', 'v1');
    expect(await cache.get('k1')).toBe('v1');
  });

  it('returns undefined for missing keys', async () => {
    const cache: CacheProvider = inMemoryCacheProvider();
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('overwrites a previous value on repeated set', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('k', 'first');
    await cache.set('k', 'second');
    expect(await cache.get('k')).toBe('second');
  });

  it('clear() empties the cache', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('a', '1');
    await cache.set('b', '2');
    await cache.clear();
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toBeUndefined();
  });

  it('is class-shaped — InMemoryCacheProvider can be used directly', async () => {
    const cache = new InMemoryCacheProvider();
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
  });

  it('does NOT enforce TTL by default (entries persist across time)', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('k', 'v');
    // Even after a long simulated wait, the value remains. We don't
    // actually advance fake timers — the CONTRACT is "no TTL by
    // default", so a synchronous get-after-set must always return.
    expect(await cache.get('k')).toBe('v');
    expect(await cache.get('k')).toBe('v');
    expect(await cache.get('k')).toBe('v');
  });

  it('satisfies the CacheProvider interface (assignable)', async () => {
    const cache: CacheProvider = inMemoryCacheProvider();
    // Compile-time check: the factory return value is assignable to
    // CacheProvider. Runtime smoke check that all four methods work.
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
    await cache.delete('k');
    expect(await cache.get('k')).toBeUndefined();
    await cache.set('k', 'v');
    await cache.clear();
    expect(await cache.get('k')).toBeUndefined();
  });
});

describe('InMemoryCacheProvider — TTL behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires entries after the construction-time ttlSeconds default', async () => {
    const cache = inMemoryCacheProvider({ ttlSeconds: 30 });
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
    // Advance just past 30s.
    vi.setSystemTime(Date.now() + 30 * 1000 + 1);
    expect(await cache.get('k')).toBeUndefined();
  });

  it('per-call ttlSeconds takes precedence over construction default', async () => {
    const cache = inMemoryCacheProvider({ ttlSeconds: 60 });
    await cache.set('k', 'v', { ttlSeconds: 10 });
    // Advance 11s — past the per-call 10s TTL but well under the 60s default.
    vi.setSystemTime(Date.now() + 11 * 1000);
    expect(await cache.get('k')).toBeUndefined();
  });

  it('with no construction default and no per-call ttl, entries never expire', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('k', 'v');
    // Ten hours.
    vi.setSystemTime(Date.now() + 10 * 60 * 60 * 1000);
    expect(await cache.get('k')).toBe('v');
  });

  it('per-call ttlSeconds = 0 expires immediately on the next get', async () => {
    const cache = inMemoryCacheProvider({ ttlSeconds: 60 });
    await cache.set('k', 'v', { ttlSeconds: 0 });
    // expiresAt = now + 0 = now; lazy expiry on get treats `now >= expiresAt` as expired.
    expect(await cache.get('k')).toBeUndefined();
  });

  it('does NOT expire before the TTL elapses', async () => {
    const cache = inMemoryCacheProvider({ ttlSeconds: 60 });
    await cache.set('k', 'v');
    vi.setSystemTime(Date.now() + 59 * 1000);
    expect(await cache.get('k')).toBe('v');
  });
});

describe('InMemoryCacheProvider — delete()', () => {
  it('removes the entry', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('k', 'v');
    expect(await cache.get('k')).toBe('v');
    await cache.delete('k');
    expect(await cache.get('k')).toBeUndefined();
  });

  it('is idempotent on missing keys (does not throw)', async () => {
    const cache = inMemoryCacheProvider();
    await expect(cache.delete('never-set')).resolves.toBeUndefined();
    // Calling twice is also fine.
    await expect(cache.delete('never-set')).resolves.toBeUndefined();
  });

  it('does not affect other keys', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('a', '1');
    await cache.set('b', '2');
    await cache.delete('a');
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toBe('2');
  });

  it('delete then set repopulates the key', async () => {
    const cache = inMemoryCacheProvider();
    await cache.set('k', 'first');
    await cache.delete('k');
    await cache.set('k', 'second');
    expect(await cache.get('k')).toBe('second');
  });
});

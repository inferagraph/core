import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lruCache } from '../../src/cache/lruCache.js';

describe('lruCache', () => {
  describe('default config', () => {
    it('uses maxEntries=500 + ttl=24h when both are unset', async () => {
      const cache = lruCache();
      // Smoke: it should accept up to 500 entries without dropping the first.
      for (let i = 0; i < 500; i++) {
        await cache.set(`k${i}`, `v${i}`);
      }
      expect(await cache.get('k0')).toBe('v0');
      expect(await cache.get('k499')).toBe('v499');
    });

    it('evicts the LRU entry when 501st entry is inserted', async () => {
      const cache = lruCache();
      for (let i = 0; i < 500; i++) {
        await cache.set(`k${i}`, `v${i}`);
      }
      // Touch k0 so it becomes MRU; then k1 becomes the LRU and should be
      // evicted on the next set.
      expect(await cache.get('k0')).toBe('v0');
      await cache.set('k500', 'v500');
      expect(await cache.get('k1')).toBeUndefined();
      expect(await cache.get('k0')).toBe('v0');
      expect(await cache.get('k500')).toBe('v500');
    });
  });

  describe('maxEntries-only config', () => {
    it('respects maxEntries and disables ttl', async () => {
      const cache = lruCache({ maxEntries: 3 });
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');
      await cache.set('d', '4'); // evicts 'a'
      expect(await cache.get('a')).toBeUndefined();
      expect(await cache.get('b')).toBe('2');
      expect(await cache.get('c')).toBe('3');
      expect(await cache.get('d')).toBe('4');
    });

    it('still resolves entries far in the future since ttl is no-limit', async () => {
      vi.useFakeTimers();
      try {
        const cache = lruCache({ maxEntries: 3 });
        await cache.set('a', '1');
        // Advance one year. Entry should still be present because ttl is
        // disabled when only maxEntries is set.
        vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60 * 1000);
        expect(await cache.get('a')).toBe('1');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('ttl-only config', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('expires entries after the configured TTL', async () => {
      const cache = lruCache({ ttl: '5m' });
      await cache.set('a', '1');
      expect(await cache.get('a')).toBe('1');
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
      expect(await cache.get('a')).toBeUndefined();
    });

    it('keeps entries that have not yet expired', async () => {
      const cache = lruCache({ ttl: '5m' });
      await cache.set('a', '1');
      vi.setSystemTime(Date.now() + 4 * 60 * 1000);
      expect(await cache.get('a')).toBe('1');
    });

    it('allows arbitrarily many entries (no maxEntries bound)', async () => {
      const cache = lruCache({ ttl: '24h' });
      for (let i = 0; i < 10_000; i++) {
        await cache.set(`k${i}`, `v${i}`);
      }
      expect(await cache.get('k0')).toBe('v0');
      expect(await cache.get('k9999')).toBe('v9999');
    });

    it('accepts a numeric ms ttl', async () => {
      const cache = lruCache({ ttl: 100 });
      await cache.set('a', '1');
      expect(await cache.get('a')).toBe('1');
      vi.setSystemTime(Date.now() + 101);
      expect(await cache.get('a')).toBeUndefined();
    });
  });

  describe('both bounds set', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('evicts on whichever bound trips first (count)', async () => {
      const cache = lruCache({ maxEntries: 2, ttl: '24h' });
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');
      expect(await cache.get('a')).toBeUndefined();
    });

    it('evicts on whichever bound trips first (ttl)', async () => {
      const cache = lruCache({ maxEntries: 100, ttl: '5m' });
      await cache.set('a', '1');
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
      expect(await cache.get('a')).toBeUndefined();
    });
  });

  describe('-1 disables a bound', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('-1 maxEntries means unlimited entries', async () => {
      const cache = lruCache({ maxEntries: -1, ttl: '24h' });
      for (let i = 0; i < 5_000; i++) {
        await cache.set(`k${i}`, `v${i}`);
      }
      expect(await cache.get('k0')).toBe('v0');
      expect(await cache.get('k4999')).toBe('v4999');
    });

    it('-1 ttl (number) means no expiry', async () => {
      const cache = lruCache({ maxEntries: 10, ttl: -1 });
      await cache.set('a', '1');
      vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60 * 1000);
      expect(await cache.get('a')).toBe('1');
    });

    it('"-1" ttl (string) means no expiry', async () => {
      const cache = lruCache({ maxEntries: 10, ttl: '-1' });
      await cache.set('a', '1');
      vi.setSystemTime(Date.now() + 365 * 24 * 60 * 60 * 1000);
      expect(await cache.get('a')).toBe('1');
    });

    it('both -1 means an unbounded cache', async () => {
      const cache = lruCache({ maxEntries: -1, ttl: -1 });
      for (let i = 0; i < 5_000; i++) {
        await cache.set(`k${i}`, `v${i}`);
      }
      vi.setSystemTime(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
      expect(await cache.get('k0')).toBe('v0');
    });
  });

  describe('LRU eviction order', () => {
    it('promotes a key to MRU on get()', async () => {
      const cache = lruCache({ maxEntries: 3 });
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');
      // 'a' would be the LRU; touch it to promote.
      await cache.get('a');
      await cache.set('d', '4');
      // 'b' should now be the LRU and gone; 'a' survives.
      expect(await cache.get('b')).toBeUndefined();
      expect(await cache.get('a')).toBe('1');
    });

    it('updating an existing key promotes it to MRU', async () => {
      const cache = lruCache({ maxEntries: 3 });
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');
      await cache.set('a', '1-updated'); // move 'a' to MRU
      await cache.set('d', '4'); // should evict 'b'
      expect(await cache.get('b')).toBeUndefined();
      expect(await cache.get('a')).toBe('1-updated');
    });
  });

  describe('clear()', () => {
    it('drops every entry', async () => {
      const cache = lruCache({ maxEntries: 10 });
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.clear();
      expect(await cache.get('a')).toBeUndefined();
      expect(await cache.get('b')).toBeUndefined();
    });

    it('is idempotent', async () => {
      const cache = lruCache({ maxEntries: 10 });
      await cache.clear();
      await cache.clear();
      expect(await cache.get('anything')).toBeUndefined();
    });
  });

  describe('get() on miss', () => {
    it('returns undefined', async () => {
      const cache = lruCache();
      expect(await cache.get('missing')).toBeUndefined();
    });
  });
});

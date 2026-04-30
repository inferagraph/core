import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine, isKeywordShape } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../src/cache/lruCache.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import type { Vector } from '../../src/ai/Embedding.js';

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('1', {
    name: 'Adam',
    type: 'person',
    era: 'Creation',
    aliases: ['First Man'],
  });
  store.addNode('2', { name: 'Eve', type: 'person', era: 'Creation' });
  store.addNode('3', { name: 'Eden', type: 'place', era: 'Creation' });
  store.addNode('4', { name: 'Abraham', type: 'person', era: 'Patriarchs' });
  return store;
}

describe('isKeywordShape', () => {
  it('treats single short tokens as keyword', () => {
    expect(isKeywordShape('adam')).toBe(true);
    expect(isKeywordShape('noah')).toBe(true);
    expect(isKeywordShape('eden')).toBe(true);
  });

  it('treats up to 3 lowercase tokens as keyword', () => {
    expect(isKeywordShape('sons of noah')).toBe(true);
    expect(isKeywordShape('early-patriarchs')).toBe(true);
  });

  it('treats 4+ tokens as semantic', () => {
    expect(isKeywordShape('a four token query here')).toBe(false);
  });

  it('treats anything with capitals as semantic', () => {
    expect(isKeywordShape('Adam')).toBe(false);
    expect(isKeywordShape('Tell me')).toBe(false);
  });

  it('treats anything with punctuation as semantic', () => {
    expect(isKeywordShape('hello?')).toBe(false);
    expect(isKeywordShape('what is this')).toBe(true); // no punctuation, 3 tokens
    expect(isKeywordShape("what's this")).toBe(false); // apostrophe
  });

  it('handles empty string as keyword (degenerate path)', () => {
    expect(isKeywordShape('')).toBe(true);
    expect(isKeywordShape('   ')).toBe(true);
  });
});

describe('AIEngine.search()', () => {
  let store: GraphStore;
  let engine: AIEngine;

  beforeEach(() => {
    store = makeStore();
    engine = new AIEngine(store, new QueryEngine(store));
  });

  describe('keyword path (always available)', () => {
    it('returns [] for empty query', async () => {
      const results = await engine.search('   ');
      expect(results).toEqual([]);
    });

    it('finds by name', async () => {
      const results = await engine.search('adam');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].nodeId).toBe('1');
    });

    it('populates matchedField with the matching attribute key', async () => {
      const results = await engine.search('adam');
      expect(results[0].matchedField).toBe('name');
    });

    it('honours k', async () => {
      // Substring "a" appears in Adam, Abraham, Eden, Eve aliases, etc.
      // We want at least 2 hits; assert k=1 trims to 1.
      const all = await engine.search('a');
      expect(all.length).toBeGreaterThan(1);
      const limited = await engine.search('a', { k: 1 });
      expect(limited).toHaveLength(1);
    });

    it('runs keyword even when an embedding tier is available', async () => {
      // Tier 3 wired but query is keyword-shaped — must not call embed().
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      const results = await engine.search('eden');
      expect(results[0]?.nodeId).toBe('3');
      expect(provider.getEmbedCallCount()).toBe(0);
    });
  });

  describe('semantic path (Tier 1 fallback)', () => {
    it('falls back to keyword when no embedding tier is configured', async () => {
      const results = await engine.search('Tell me about the first humans.');
      // Keyword on "Tell me about the first humans." won't match the
      // word-by-word; data-layer SearchEngine does substring includes.
      // The query string itself is unlikely to substring-match anything,
      // so an empty array is acceptable. The point: no throw + no embed.
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('semantic path (Tier 3)', () => {
    it('embeds the query and ranks via the store', async () => {
      // Canned vectors so we can reason about ranking deterministically.
      const adamVec: Vector = [1, 0, 0];
      const eveVec: Vector = [0.9, 0.1, 0];
      const edenVec: Vector = [0, 1, 0];
      const abrahamVec: Vector = [-1, 0, 0];

      const provider = mockLLMProvider({}, (text: string): Vector => {
        if (/Adam/.test(text)) return adamVec.slice();
        if (/Eve/.test(text)) return eveVec.slice();
        if (/Eden/.test(text)) return edenVec.slice();
        if (/Abraham/.test(text)) return abrahamVec.slice();
        // The query: pretend it asks about creation-era people.
        return adamVec.slice();
      });

      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      // Pre-warm so the search call sees populated embeddings.
      await engine.ensureEmbeddings();

      const hits = await engine.search('Who was the first man on Earth?');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].nodeId).toBe('1'); // Adam — exact match to query vector
      // Eve (close), Eden (orthogonal), Abraham (opposing) follow.
      const ids = hits.map((h) => h.nodeId);
      expect(ids.indexOf('1')).toBe(0);
      expect(ids.indexOf('4')).toBe(ids.length - 1);
    });

    it('returns at most k hits in semantic path', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      await engine.ensureEmbeddings();
      const hits = await engine.search('Long sentence-shaped query here please.', { k: 2 });
      expect(hits.length).toBeLessThanOrEqual(2);
    });

    it('honours pre-aborted signals', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      const ctrl = new AbortController();
      ctrl.abort();
      const hits = await engine.search('Long sentence-shaped query here please.', {
        signal: ctrl.signal,
      });
      expect(hits).toEqual([]);
    });

    it('returns [] when the embed call fails (no throw)', async () => {
      const provider = mockLLMProvider({});
      // Replace embed with a thrower
      Object.defineProperty(provider, 'embed', {
        value: async () => {
          throw new Error('boom');
        },
      });
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      const hits = await engine.search('Long sentence-shaped query here please.');
      expect(hits).toEqual([]);
    });
  });

  describe('semantic path (Tier 2 / cache-as-vector-store)', () => {
    it('persists embeddings in the cache and uses in-memory similarity', async () => {
      const adamVec: Vector = [1, 0, 0];
      const provider = mockLLMProvider({}, (text: string): Vector => {
        if (/Adam/.test(text)) return adamVec.slice();
        if (/Eve/.test(text)) return [0.5, 0.5, 0];
        if (/Eden/.test(text)) return [0, 1, 0];
        if (/Abraham/.test(text)) return [-1, 0, 0];
        return adamVec.slice();
      });
      const cache = lruCache();
      engine.setProvider(provider);
      engine.setCache(cache);
      await engine.ensureEmbeddings();
      const hits = await engine.search('Tell me about the very first human.');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].nodeId).toBe('1');
    });
  });
});

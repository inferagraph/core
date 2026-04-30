import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../src/cache/lruCache.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import {
  contentHash,
  type EmbeddingRecord,
  type EmbeddingStore,
  type Vector,
} from '../../src/ai/Embedding.js';
import { embeddingText } from '../../src/ai/SchemaInspector.js';

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('1', { name: 'Adam', type: 'person', era: 'Creation' });
  store.addNode('2', { name: 'Eve', type: 'person', era: 'Creation' });
  store.addNode('3', { name: 'Eden', type: 'place', era: 'Creation' });
  store.addNode('4', { name: 'Abraham', type: 'person', era: 'Patriarchs' });
  return store;
}

describe('AIEngine — embeddings', () => {
  let store: GraphStore;
  let engine: AIEngine;

  beforeEach(() => {
    store = makeStore();
    engine = new AIEngine(store, new QueryEngine(store));
  });

  describe('tier detection', () => {
    it('reports tier-1 with no provider, no cache, no store', () => {
      expect(engine.getEmbeddingTier()).toBe('tier-1');
    });

    it('reports tier-1 even when a cache is set if the provider lacks embed()', () => {
      // Build a provider literal that omits embed() entirely.
      const provider = {
        name: 'noembed',
        complete: async () => '',
        async *stream() {
          yield { type: 'done', reason: 'stop' as const };
        },
      };
      engine.setProvider(provider);
      engine.setCache(lruCache());
      expect(engine.getEmbeddingTier()).toBe('tier-1');
    });

    it('reports tier-2 with cache + provider that implements embed()', () => {
      engine.setProvider(mockLLMProvider({}));
      engine.setCache(lruCache());
      expect(engine.getEmbeddingTier()).toBe('tier-2');
    });

    it('reports tier-3 when an embeddingStore is supplied', () => {
      engine.setProvider(mockLLMProvider({}));
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      expect(engine.getEmbeddingTier()).toBe('tier-3');
    });

    it('tier-3 wins over tier-2 when both cache and store are set', () => {
      engine.setProvider(mockLLMProvider({}));
      engine.setCache(lruCache());
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      expect(engine.getEmbeddingTier()).toBe('tier-3');
    });
  });

  describe('ensureEmbeddings()', () => {
    it('is a no-op for tier-1', async () => {
      await expect(engine.ensureEmbeddings()).resolves.toBeUndefined();
    });

    it('embeds every node into the dedicated store (tier-3)', async () => {
      const provider = mockLLMProvider({});
      const store3 = inMemoryEmbeddingStore();
      engine.setProvider(provider);
      engine.setEmbeddingStore(store3);
      await engine.ensureEmbeddings();
      expect(provider.getEmbedCallCount()).toBe(1); // single batch
      // Every node now has a vector in the store.
      const records: EmbeddingRecord[] = [];
      for (const id of ['1', '2', '3', '4']) {
        const node = store.getNode(id)!;
        const text = embeddingText({ id: node.id, attributes: node.attributes });
        const hash = contentHash(text);
        const hit = await store3.get(id, 'mock', '', hash);
        expect(hit).toBeDefined();
        records.push(hit!);
      }
      expect(records).toHaveLength(4);
      // Every record carries provenance.
      for (const r of records) {
        expect(r.meta.model).toBe('mock');
        expect(r.meta.modelVersion).toBe('');
        expect(r.meta.generatedAt).toMatch(/\dT\d/);
        expect(r.meta.contentHash).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    it('persists embeddings via the cache for tier-2', async () => {
      const provider = mockLLMProvider({});
      const cache = lruCache();
      engine.setProvider(provider);
      engine.setCache(cache);
      await engine.ensureEmbeddings();
      // The cache should now hold an index entry.
      const indexRaw = await cache.get('__inferagraph_embed_index__');
      expect(indexRaw).toBeDefined();
      const list = JSON.parse(indexRaw!) as string[];
      expect(list).toHaveLength(4);
    });

    it('is idempotent — second call does NOT re-embed unchanged nodes', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      await engine.ensureEmbeddings();
      expect(provider.getEmbedCallCount()).toBe(1);
      // Force the warmup signature to recompute by issuing a fresh ensure
      // call after wiping the in-flight Promise.
      // Concurrent same-call coalescing means a literal second call shares
      // the same Promise; we want to test the "data unchanged → no rework"
      // path. Setting the same provider re-arms warmup.
      engine.setProvider(provider);
      await engine.ensureEmbeddings();
      // Second pass found every node in the store and produced no new embeds.
      expect(provider.getEmbedCallCount()).toBe(1);
    });

    it('coalesces concurrent calls into a single batch', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      await Promise.all([
        engine.ensureEmbeddings(),
        engine.ensureEmbeddings(),
        engine.ensureEmbeddings(),
      ]);
      expect(provider.getEmbedCallCount()).toBe(1);
    });

    it('re-embeds when the model changes (cache-buster via composite key)', async () => {
      // Provider 1: name "mock", default model
      const p1 = mockLLMProvider({});
      engine.setProvider(p1);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      await engine.ensureEmbeddings();
      expect(p1.getEmbedCallCount()).toBe(1);

      // Swap to a provider whose name (used as the model identifier)
      // is different — every node looks "missing" under the new model
      // scope and gets re-embedded.
      const p2 = mockLLMProvider({});
      Object.defineProperty(p2, 'name', { value: 'other-mock' });
      engine.setProvider(p2);
      await engine.ensureEmbeddings();
      expect(p2.getEmbedCallCount()).toBe(1);
    });

    it('re-embeds a single node when its content hash changes', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      const embStore = inMemoryEmbeddingStore();
      engine.setEmbeddingStore(embStore);
      await engine.ensureEmbeddings();
      const initial = provider.getEmbedCallCount();
      expect(initial).toBe(1);

      // Mutate node 1's attributes so its embedding text changes.
      store.getNode('1')!.attributes.era = 'Antediluvian';
      // Force a fresh signature so the engine re-evaluates.
      engine.setProvider(provider);
      await engine.ensureEmbeddings();
      expect(provider.getEmbedCallCount()).toBe(initial + 1);
      // Only one node was sent in the second batch.
      expect(provider.getLastEmbedBatch()).toHaveLength(1);
    });

    it('falls back gracefully when the provider lacks embed', async () => {
      const provider = {
        name: 'noembed',
        complete: async () => '',
        async *stream() {
          yield { type: 'done', reason: 'stop' as const };
        },
      };
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      // Tier-1 because providerHasEmbed() is false → ensure resolves no-op.
      await expect(engine.ensureEmbeddings()).resolves.toBeUndefined();
    });
  });

  describe('background-warmup behavior', () => {
    it('returns a Promise the caller can fire-and-forget', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      const p = engine.ensureEmbeddings();
      expect(p).toBeInstanceOf(Promise);
      await p;
    });

    it('subsequent calls within the same data version share the same Promise', () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      const a = engine.ensureEmbeddings();
      const b = engine.ensureEmbeddings();
      expect(a).toBe(b);
    });
  });

  describe('custom embedding store', () => {
    it('delegates persistence to the host-provided store', async () => {
      const calls: EmbeddingRecord[] = [];
      const custom: EmbeddingStore = {
        async get() {
          return undefined;
        },
        async set(record: EmbeddingRecord) {
          calls.push(record);
        },
        async similar() {
          return [];
        },
        async clear() {
          /* noop */
        },
      };
      engine.setProvider(mockLLMProvider({}));
      engine.setEmbeddingStore(custom);
      await engine.ensureEmbeddings();
      expect(calls).toHaveLength(4);
      for (const r of calls) {
        expect(r.vector.length).toBeGreaterThan(0);
        expect(r.meta.contentHash).toBeDefined();
      }
    });

    it('returns delegated similarity results untouched (semantic path)', async () => {
      let lastQuery: Vector | undefined;
      const custom: EmbeddingStore = {
        async get() {
          return undefined;
        },
        async set() {
          /* noop */
        },
        async similar(q) {
          lastQuery = q;
          return [
            { nodeId: '4', score: 0.99 },
            { nodeId: '1', score: 0.5 },
          ];
        },
        async clear() {
          /* noop */
        },
      };
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      engine.setEmbeddingStore(custom);
      // sentence-shaped query → semantic path
      const hits = await engine.search('Tell me about the patriarchs of antiquity.', { k: 5 });
      expect(lastQuery).toBeDefined();
      expect(hits.map((h) => h.nodeId)).toEqual(['4', '1']);
    });
  });
});

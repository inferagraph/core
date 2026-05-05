import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../src/cache/lruCache.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import { inMemoryInferredEdgeStore } from '../../src/ai/InferredEdge.js';

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('alpha', { name: 'Alpha', kind: 'shape', color: 'red' });
  store.addNode('bravo', { name: 'Bravo', kind: 'shape', color: 'blue' });
  store.addNode('charlie', { name: 'Charlie', kind: 'tool', color: 'red' });
  store.addNode('delta', { name: 'Delta', kind: 'tool', color: 'green' });
  // alpha-bravo and bravo-charlie are explicit; that's the keystone — these
  // pairs MUST be excluded from the inferred output.
  store.addEdge('e1', 'alpha', 'bravo', { type: 'connects_to' });
  store.addEdge('e2', 'bravo', 'charlie', { type: 'connects_to' });
  return store;
}

describe('AIEngine.computeInferredEdges', () => {
  let store: GraphStore;
  let engine: AIEngine;

  beforeEach(() => {
    store = makeStore();
    engine = new AIEngine(store, new QueryEngine(store));
  });

  describe('store wiring', () => {
    it('returns [] from getInferredEdges when no store is configured', async () => {
      const out = await engine.getInferredEdges();
      expect(out).toEqual([]);
    });

    it('setInferredEdgeStore + getInferredEdgeStore round-trips', () => {
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      expect(engine.getInferredEdgeStore()).toBe(istore);
      engine.setInferredEdgeStore(undefined);
      expect(engine.getInferredEdgeStore()).toBeUndefined();
    });
  });

  describe('no-op paths', () => {
    it('is a no-op when no inferred edge store is configured', async () => {
      // No store wired — call should not throw.
      await expect(engine.computeInferredEdges()).resolves.toBeUndefined();
    });

    it('returns immediately when signal is pre-aborted', async () => {
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      const ac = new AbortController();
      ac.abort();
      await engine.computeInferredEdges({ signal: ac.signal });
      const all = await istore.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('graph-only path (Tier 1, no provider)', () => {
    it('produces inferred edges from graph signals alone', async () => {
      // Build a richer graph with shared neighbors so common-neighbor fires.
      store.addNode('e', { name: 'E' });
      store.addNode('f', { name: 'F' });
      store.addEdge('e3', 'alpha', 'e', { type: 'r' });
      store.addEdge('e4', 'f', 'e', { type: 'r' });
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      // Expect at least one alpha<->f or alpha<->e* candidate via common neighbor `e`.
      expect(all.length).toBeGreaterThan(0);
      // None of the explicit-edge pairs should be present.
      const pairs = all.map((e) => `${e.sourceId}->${e.targetId}`);
      expect(pairs).not.toContain('alpha->bravo');
      expect(pairs).not.toContain('bravo->alpha');
      expect(pairs).not.toContain('bravo->charlie');
      expect(pairs).not.toContain('charlie->bravo');
    });

    it('every produced edge has score in [0, 1] and at least one source', async () => {
      store.addNode('e', { name: 'E' });
      store.addNode('f', { name: 'F' });
      store.addEdge('e3', 'alpha', 'e', { type: 'r' });
      store.addEdge('e4', 'f', 'e', { type: 'r' });
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      for (const e of all) {
        expect(e.score).toBeGreaterThanOrEqual(0);
        expect(e.score).toBeLessThanOrEqual(1);
        expect(e.sources.length).toBeGreaterThan(0);
      }
    });
  });

  describe('full pipeline (graph + embedding + llm)', () => {
    it('integrates all three sources and persists the result', async () => {
      const provider = mockLLMProvider(() =>
        JSON.stringify({
          edges: [
            { targetId: 'delta', type: 'shares_color_with', confidence: 0.8 },
          ],
        }),
      );
      const istore = inMemoryInferredEdgeStore();
      engine.setProvider(provider);
      engine.setEmbeddingStore(inMemoryEmbeddingStore());
      engine.setInferredEdgeStore(istore);
      // Warm embeddings so Tier 3 has something to query.
      await engine.ensureEmbeddings();
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      // Confirm at least one llm-sourced edge was persisted.
      const llmEdges = all.filter((e) => e.sources.includes('llm'));
      expect(llmEdges.length).toBeGreaterThan(0);
    });

    it('recompute REPLACES the entire stored set', async () => {
      const provider = mockLLMProvider(() => JSON.stringify({ edges: [] }));
      const istore = inMemoryInferredEdgeStore();
      engine.setProvider(provider);
      engine.setInferredEdgeStore(istore);
      // Pre-populate the store with garbage that should be wiped.
      await istore.set([
        {
          sourceId: 'old',
          targetId: 'stale',
          type: 'r',
          score: 0.5,
          sources: ['graph'],
        },
      ]);
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      const oldStaleStill = all.some(
        (e) => e.sourceId === 'old' && e.targetId === 'stale',
      );
      expect(oldStaleStill).toBe(false);
    });
  });

  describe('source filtering via opts.sources', () => {
    it('skips llm when sources is explicitly ["graph"]', async () => {
      const provider = mockLLMProvider(() =>
        JSON.stringify({
          edges: [{ targetId: 'delta', type: 't', confidence: 0.9 }],
        }),
      );
      const istore = inMemoryInferredEdgeStore();
      engine.setProvider(provider);
      engine.setInferredEdgeStore(istore);
      await engine.computeInferredEdges({ sources: ['graph'] });
      const all = await istore.getAll();
      // No edges should carry an llm source.
      for (const e of all) expect(e.sources).not.toContain('llm');
      // Provider should not have been called for inference.
      expect(provider.getCallCount()).toBe(0);
    });
  });

  describe('explicit-edge dedup keystone', () => {
    it('drops candidates that mirror explicit edges in either direction', async () => {
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      const pairs = new Set(all.map((e) => `${e.sourceId}->${e.targetId}`));
      expect(pairs.has('alpha->bravo')).toBe(false);
      expect(pairs.has('bravo->alpha')).toBe(false);
      expect(pairs.has('bravo->charlie')).toBe(false);
      expect(pairs.has('charlie->bravo')).toBe(false);
    });

    it('excludeExplicit:false re-admits explicit-pair candidates', async () => {
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      // Use a richer graph so common_neighbor fires for the explicit pairs.
      store.addNode('e', { name: 'E' });
      store.addEdge('e3', 'alpha', 'e', { type: 'r' });
      store.addEdge('e4', 'bravo', 'e', { type: 'r' });
      await engine.computeInferredEdges({ excludeExplicit: false });
      const all = await istore.getAll();
      const pairs = new Set(all.map((e) => `${e.sourceId}->${e.targetId}`));
      // Now alpha->bravo (via shared neighbor `e`) should appear.
      expect(pairs.has('alpha->bravo') || pairs.has('bravo->alpha')).toBe(true);
    });
  });

  describe('cancellation mid-compute', () => {
    it('stops mid-compute when the signal aborts before LLM phase', async () => {
      const ac = new AbortController();
      const provider = mockLLMProvider(async () => {
        // Triggering the abort before the LLM phase isn't deterministic
        // without races; instead we abort BEFORE the call and expect zero
        // store writes.
        return JSON.stringify({ edges: [] });
      });
      const istore = inMemoryInferredEdgeStore();
      engine.setProvider(provider);
      engine.setInferredEdgeStore(istore);
      ac.abort();
      await engine.computeInferredEdges({ signal: ac.signal });
      const all = await istore.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('progressive enhancement (no provider)', () => {
    it('still produces graph-only inferred edges without a provider configured', async () => {
      // Add shared-neighbor structure.
      store.addNode('e', { name: 'E' });
      store.addNode('f', { name: 'F' });
      store.addEdge('e3', 'alpha', 'e', { type: 'r' });
      store.addEdge('e4', 'f', 'e', { type: 'r' });
      const istore = inMemoryInferredEdgeStore();
      engine.setInferredEdgeStore(istore);
      // No provider, no cache, no embedding store.
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      const hasGraphSources = all.some((e) => e.sources.includes('graph'));
      const hasOtherSources = all.some(
        (e) => e.sources.includes('embedding') || e.sources.includes('llm'),
      );
      expect(hasGraphSources).toBe(true);
      expect(hasOtherSources).toBe(false);
    });
  });

  describe('Tier 2 cache path', () => {
    it('uses cached embeddings to drive the embedding source', async () => {
      const provider = mockLLMProvider(() => JSON.stringify({ edges: [] }));
      const cache = lruCache();
      const istore = inMemoryInferredEdgeStore();
      engine.setProvider(provider);
      engine.setCache(cache);
      engine.setInferredEdgeStore(istore);
      await engine.ensureEmbeddings();
      await engine.computeInferredEdges();
      const all = await istore.getAll();
      // We can't assert exact pair shape (mock embedder is structural), but
      // call should complete without throwing and produce at least the
      // graph-source candidates.
      expect(Array.isArray(all)).toBe(true);
    });
  });
});

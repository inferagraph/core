// Fix 7 (0.9.0): GraphIndexer.computeInferredEdges supports a batched
// prompt mode controlled by `inferredEdgeBatchSize`. Default 1 preserves
// the existing one-call-per-pair behavior; values > 1 send K candidate
// pairs in a single LLM completion and parse a JSON array of K
// descriptions back. Malformed batch responses fall back to per-pair
// calls for THAT batch (defensive parsing) so one bad batch never breaks
// the whole indexing pass.

import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import { inMemoryInferredEdgeStore } from '../../src/ai/InferredEdge.js';
import { GraphIndexer } from '../../src/ai/GraphIndexer.js';
import type { LLMProvider, LLMStreamEvent } from '../../src/ai/LLMProvider.js';
import type { Vector } from '../../src/ai/Embedding.js';

interface ProviderOpts {
  embed?: (texts: string[]) => Promise<Vector[]>;
  complete?: (prompt: string) => Promise<string>;
}

function makeProvider(opts: ProviderOpts = {}): LLMProvider & {
  embed: (texts: string[]) => Promise<Vector[]>;
} {
  const embedFn = opts.embed ?? (async (texts) => texts.map(() => [1, 0, 0]));
  const completeFn = opts.complete ?? (async () => 'related');
  return {
    name: 'mock',
    async complete(prompt: string) {
      return completeFn(prompt);
    },
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<LLMStreamEvent, void, unknown> {
      return;
    },
    async embed(texts: string[]) {
      return embedFn(texts);
    },
  };
}

/** Build a 4-node store where every pair embeds to the same vector. */
function makeFourSimilarNodes(): GraphStore {
  const store = new GraphStore();
  for (let i = 0; i < 4; i++) {
    store.addNode(`n${i}`, { name: `N${i}`, content: 'identical body' });
  }
  return store;
}

describe('GraphIndexer.computeInferredEdges — batched prompt mode', () => {
  it('default batchSize=1 preserves one complete() call per pair', async () => {
    const store = makeFourSimilarNodes();
    let completeCalls = 0;
    const provider = makeProvider({
      complete: async () => {
        completeCalls += 1;
        return 'related entities';
      },
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 5,
    });
    await indexer.embedAll();
    const { created } = await indexer.computeInferredEdges();
    // 4 nodes, all similar, max 5 per node → all 6 pairs accepted.
    expect(created).toBe(6);
    expect(completeCalls).toBe(6);
  });

  it('batchSize=4 issues 1 complete() call per 4 pairs and parses JSON array', async () => {
    const store = makeFourSimilarNodes();
    let completeCalls = 0;
    const provider = makeProvider({
      complete: async (prompt) => {
        completeCalls += 1;
        // Count pairs in the prompt (rows like "1. A <-> B (cosine ...)").
        const pairCount = (prompt.match(/^\d+\.\s/gm) ?? []).length;
        const descriptions = Array.from(
          { length: pairCount },
          (_, i) => `desc-${completeCalls}-${i + 1}`,
        );
        return JSON.stringify({ descriptions });
      },
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 5,
      inferredEdgeBatchSize: 4,
    });
    await indexer.embedAll();
    const { created } = await indexer.computeInferredEdges();
    // 6 candidate pairs / batchSize 4 → 2 batches → 2 complete() calls.
    expect(created).toBe(6);
    expect(completeCalls).toBe(2);
    const all = await inferredEdgeStore.getAll();
    expect(all).toHaveLength(6);
    // Every persisted edge should carry one of the four descriptions
    // (or the second batch's, which uses the same JSON shape).
    for (const e of all) {
      expect(e.reasoning).toMatch(/^desc-/);
    }
  });

  it('cost guard: batched mode reduces complete() calls vs unbatched', async () => {
    const store = makeFourSimilarNodes();
    // Run unbatched.
    let unbatchedCalls = 0;
    const unbatched = makeProvider({
      complete: async () => {
        unbatchedCalls += 1;
        return 'plain';
      },
    });
    const ix1 = new GraphIndexer({
      store,
      provider: unbatched,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore: inMemoryInferredEdgeStore(),
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 5,
    });
    await ix1.embedAll();
    await ix1.computeInferredEdges();

    // Now batched.
    let batchedCalls = 0;
    const batched = makeProvider({
      complete: async (prompt) => {
        batchedCalls += 1;
        const pairCount = (prompt.match(/^\d+\.\s/gm) ?? []).length;
        const descriptions = Array.from(
          { length: pairCount },
          (_, i) => `b-${batchedCalls}-${i + 1}`,
        );
        return JSON.stringify({ descriptions });
      },
    });
    const ix2 = new GraphIndexer({
      store,
      provider: batched,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore: inMemoryInferredEdgeStore(),
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 5,
      inferredEdgeBatchSize: 4,
    });
    await ix2.embedAll();
    await ix2.computeInferredEdges();

    expect(batchedCalls).toBeLessThan(unbatchedCalls);
  });

  it('malformed batch JSON falls back to per-pair calls; produces all edges anyway', async () => {
    const store = makeFourSimilarNodes();
    let calls = 0;
    const provider = makeProvider({
      complete: async (prompt) => {
        calls += 1;
        // First call (batch path): return broken JSON. Subsequent calls
        // (per-pair fallback): return a plain description.
        if (calls === 1) {
          return 'not json at all { broken';
        }
        // Per-pair calls in the fallback take a per-pair prompt; surface
        // a unique description so the test can verify the right path ran.
        void prompt;
        return 'fallback description';
      },
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 5,
      inferredEdgeBatchSize: 4,
    });
    await indexer.embedAll();
    const { created } = await indexer.computeInferredEdges();
    // Every pair eventually persisted via the fallback path.
    expect(created).toBe(6);
    // 1 broken batch call + 4 per-pair fallback calls (first batch) + 1
    // batch call for the second batch (returned as broken JSON too,
    // since `calls === 1` only matched once — actually subsequent
    // batch returns 'fallback description' which is also non-JSON, so
    // its 2 pairs also fall back, adding 2 more per-pair calls).
    // Total: 1 + 4 + 1 + 2 = 8. But the exact count is implementation-
    // dependent; what matters is that all 6 edges land.
    expect(calls).toBeGreaterThan(1);
    const all = await inferredEdgeStore.getAll();
    expect(all).toHaveLength(6);
    for (const e of all) {
      expect(e.reasoning).toBe('fallback description');
    }
  });

  it('batch JSON with wrong array length falls back to per-pair calls', async () => {
    const store = makeFourSimilarNodes();
    let calls = 0;
    const provider = makeProvider({
      complete: async () => {
        calls += 1;
        if (calls === 1) {
          // Return a 2-element array for a 4-pair batch — wrong length.
          return JSON.stringify({ descriptions: ['only', 'two'] });
        }
        return 'per-pair fallback';
      },
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 5,
      inferredEdgeBatchSize: 4,
    });
    await indexer.embedAll();
    const { created } = await indexer.computeInferredEdges();
    expect(created).toBe(6);
    // First batch fallback: 4 per-pair calls; second batch + maybe its
    // fallbacks. Just verify edges all carry the fallback description.
    const all = await inferredEdgeStore.getAll();
    expect(all).toHaveLength(6);
    expect(
      all.every((e) => e.reasoning === 'per-pair fallback'),
    ).toBe(true);
  });
});

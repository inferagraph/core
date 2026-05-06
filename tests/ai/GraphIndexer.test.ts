import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import { inMemoryInferredEdgeStore } from '../../src/ai/InferredEdge.js';
import { GraphIndexer } from '../../src/ai/GraphIndexer.js';
import type { LLMProvider, LLMStreamEvent } from '../../src/ai/LLMProvider.js';
import type { Vector } from '../../src/ai/Embedding.js';

function makeProvider(opts?: {
  embed?: (texts: string[]) => Promise<Vector[]>;
  complete?: (prompt: string) => Promise<string>;
  name?: string;
}): LLMProvider & { embed: (texts: string[]) => Promise<Vector[]> } {
  const embedFn =
    opts?.embed ?? (async (texts) => texts.map(() => [1, 0, 0]));
  const completeFn = opts?.complete ?? (async () => 'related');
  return {
    name: opts?.name ?? 'mock',
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

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('a', { name: 'A', content: 'apple alpha' });
  store.addNode('b', { name: 'B', content: 'banana beta' });
  store.addNode('c', { name: 'C', content: 'cherry charlie' });
  return store;
}

describe('GraphIndexer.embedAll', () => {
  it('embeds new nodes and is idempotent (cached on second run)', async () => {
    const calls: string[][] = [];
    const provider = makeProvider({
      embed: async (texts) => {
        calls.push(texts.slice());
        return texts.map(() => [1, 0, 0]);
      },
    });
    const store = makeStore();
    const embeddingStore = inMemoryEmbeddingStore();
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore,
      inferredEdgeStore,
    });

    const r1 = await indexer.embedAll();
    expect(r1.embedded).toBe(3);
    expect(r1.cached).toBe(0);

    const r2 = await indexer.embedAll();
    expect(r2.embedded).toBe(0);
    expect(r2.cached).toBe(3);
    // Second run hit cache for every node — no new embed calls.
    expect(calls.length).toBe(1);
  });

  it('batches embed calls via embeddingBatchSize', async () => {
    const batches: number[] = [];
    const provider = makeProvider({
      embed: async (texts) => {
        batches.push(texts.length);
        return texts.map(() => [1, 0, 0]);
      },
    });
    const store = new GraphStore();
    for (let i = 0; i < 5; i++) {
      store.addNode(`n${i}`, { name: `N${i}`, content: `body ${i}` });
    }
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore: inMemoryInferredEdgeStore(),
      embeddingBatchSize: 2,
    });
    await indexer.embedAll();
    // 5 nodes / batch=2 → batches of 2, 2, 1.
    expect(batches).toEqual([2, 2, 1]);
  });

  it('emits onProgress callbacks for each batch', async () => {
    const provider = makeProvider();
    const store = makeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore: inMemoryInferredEdgeStore(),
      embeddingBatchSize: 2,
    });
    const events: Array<{
      stage: string;
      completed: number;
      total: number;
    }> = [];
    await indexer.embedAll({
      onProgress: (p) => {
        events.push({ stage: p.stage, completed: p.completed, total: p.total });
      },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.stage === 'embed')).toBe(true);
    expect(events[events.length - 1].completed).toBe(3);
    expect(events[events.length - 1].total).toBe(3);
  });
});

describe('GraphIndexer.computeInferredEdges', () => {
  function makeOrthogonalProvider(): LLMProvider & {
    embed: (texts: string[]) => Promise<Vector[]>;
  } {
    // Hand-crafted vectors so similarity is deterministic per node id.
    const vectors: Record<string, Vector> = {
      A: [1, 0, 0],
      B: [0.99, 0.01, 0], // very similar to A
      C: [0, 1, 0], // orthogonal to A
    };
    return makeProvider({
      embed: async (texts) =>
        texts.map((t) => {
          // Find the title (first line, e.g. "A").
          const title = t.split('\n')[0];
          return vectors[title] ?? [0, 0, 1];
        }),
      complete: async () => 'Strongly related entities',
    });
  }

  it('proposes inferred edge for high-similarity unconnected pair', async () => {
    const store = makeStore();
    // No explicit edges — every pair is unconnected.
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider: makeOrthogonalProvider(),
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.9,
    });
    await indexer.embedAll();
    const r = await indexer.computeInferredEdges();
    expect(r.created).toBeGreaterThan(0);
    const all = await inferredEdgeStore.getAll();
    // a vs b were near-parallel; that pair should be inferred.
    const pair = all.find(
      (e) =>
        (e.sourceId === 'a' && e.targetId === 'b') ||
        (e.sourceId === 'b' && e.targetId === 'a'),
    );
    expect(pair).toBeDefined();
    // a vs c are orthogonal — should NOT be inferred at threshold 0.9.
    const orthogonal = all.find(
      (e) =>
        (e.sourceId === 'a' && e.targetId === 'c') ||
        (e.sourceId === 'c' && e.targetId === 'a'),
    );
    expect(orthogonal).toBeUndefined();
  });

  it('respects maxInferredEdgesPerNode cap', async () => {
    const store = new GraphStore();
    for (let i = 0; i < 5; i++) {
      store.addNode(`n${i}`, { name: `N${i}`, content: 'identical body' });
    }
    // All nodes embed to the same vector → every pair is similar.
    const provider = makeProvider({
      embed: async (texts) => texts.map(() => [1, 0, 0]),
      complete: async () => 'related',
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
      maxInferredEdgesPerNode: 2,
    });
    await indexer.embedAll();
    await indexer.computeInferredEdges();
    const all = await inferredEdgeStore.getAll();
    // Per-node degree on the inferred graph must be <= 2.
    const degree = new Map<string, number>();
    for (const e of all) {
      degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
      degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
    }
    for (const [, d] of degree) expect(d).toBeLessThanOrEqual(2);
  });

  it('does NOT propose for an already-connected pair', async () => {
    const store = makeStore();
    store.addEdge('e1', 'a', 'b', { type: 'related' });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider: makeOrthogonalProvider(),
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.9,
    });
    await indexer.embedAll();
    await indexer.computeInferredEdges();
    const all = await inferredEdgeStore.getAll();
    const between = all.find(
      (e) =>
        (e.sourceId === 'a' && e.targetId === 'b') ||
        (e.sourceId === 'b' && e.targetId === 'a'),
    );
    expect(between).toBeUndefined();
  });
});

describe('GraphIndexer.recomputeInferredEdgesFor', () => {
  it('recomputes only the inferred edges touching the given node', async () => {
    const store = new GraphStore();
    store.addNode('a', { name: 'A', content: 'x' });
    store.addNode('b', { name: 'B', content: 'x' });
    store.addNode('c', { name: 'C', content: 'x' });
    const provider = makeProvider({
      embed: async (texts) => texts.map(() => [1, 0, 0]),
      complete: async () => 'r',
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
    });
    await indexer.embedAll();
    await indexer.computeInferredEdges();
    const beforeAll = await inferredEdgeStore.getAll();
    const beforeAEdges = beforeAll.filter(
      (e) => e.sourceId === 'a' || e.targetId === 'a',
    ).length;
    const beforeBcEdge = beforeAll.find(
      (e) =>
        (e.sourceId === 'b' && e.targetId === 'c') ||
        (e.sourceId === 'c' && e.targetId === 'b'),
    );
    expect(beforeAEdges).toBeGreaterThan(0);
    expect(beforeBcEdge).toBeDefined();

    const r = await indexer.recomputeInferredEdgesFor('a');
    // Returns counts; we just assert shape.
    expect(typeof r.created).toBe('number');
    expect(typeof r.deleted).toBe('number');

    const after = await inferredEdgeStore.getAll();
    // The b<->c edge that didn't touch `a` must still be present.
    const afterBcEdge = after.find(
      (e) =>
        (e.sourceId === 'b' && e.targetId === 'c') ||
        (e.sourceId === 'c' && e.targetId === 'b'),
    );
    expect(afterBcEdge).toBeDefined();
  });
});

describe('GraphIndexer.reconcile', () => {
  it('drops inferred edges whose source/target nodes are gone', async () => {
    const store = new GraphStore();
    store.addNode('a', { name: 'A', content: 'x' });
    store.addNode('b', { name: 'B', content: 'x' });
    const provider = makeProvider({
      embed: async (texts) => texts.map(() => [1, 0, 0]),
      complete: async () => 'r',
    });
    const inferredEdgeStore = inMemoryInferredEdgeStore();
    const indexer = new GraphIndexer({
      store,
      provider,
      embeddingStore: inMemoryEmbeddingStore(),
      inferredEdgeStore,
      inferredEdgeThreshold: 0.5,
    });
    await indexer.embedAll();
    await indexer.computeInferredEdges();
    expect((await inferredEdgeStore.getAll()).length).toBeGreaterThan(0);

    store.removeNode('b');
    const r = await indexer.reconcile();
    expect(r.orphanInferredEdges).toBeGreaterThan(0);
    const remaining = await inferredEdgeStore.getAll();
    for (const e of remaining) {
      expect(store.hasNode(e.sourceId)).toBe(true);
      expect(store.hasNode(e.targetId)).toBe(true);
    }
  });
});

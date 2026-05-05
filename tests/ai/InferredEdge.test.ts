import { describe, it, expect, beforeEach } from 'vitest';
import {
  inMemoryInferredEdgeStore,
  type InferredEdge,
  type InferredEdgeStore,
} from '../../src/ai/InferredEdge.js';

function edge(
  sourceId: string,
  targetId: string,
  overrides?: Partial<InferredEdge>,
): InferredEdge {
  return {
    sourceId,
    targetId,
    type: overrides?.type ?? 'related_to',
    score: overrides?.score ?? 0.5,
    sources: overrides?.sources ?? ['graph'],
    reasoning: overrides?.reasoning,
    perSource: overrides?.perSource,
  };
}

describe('inMemoryInferredEdgeStore', () => {
  let store: InferredEdgeStore;

  beforeEach(() => {
    store = inMemoryInferredEdgeStore();
  });

  describe('get / set roundtrip', () => {
    it('returns undefined when nothing is stored', async () => {
      const hit = await store.get('a', 'b');
      expect(hit).toBeUndefined();
    });

    it('persists and retrieves by ordered (source, target) pair', async () => {
      const e = edge('a', 'b', { type: 'shares_setting_with', score: 0.72 });
      await store.set([e]);
      const hit = await store.get('a', 'b');
      expect(hit).toBeDefined();
      expect(hit!.sourceId).toBe('a');
      expect(hit!.targetId).toBe('b');
      expect(hit!.type).toBe('shares_setting_with');
      expect(hit!.score).toBeCloseTo(0.72, 10);
    });

    it('treats (a,b) and (b,a) as distinct ordered pairs', async () => {
      await store.set([edge('a', 'b', { score: 0.4 }), edge('b', 'a', { score: 0.9 })]);
      const ab = await store.get('a', 'b');
      const ba = await store.get('b', 'a');
      expect(ab!.score).toBeCloseTo(0.4, 10);
      expect(ba!.score).toBeCloseTo(0.9, 10);
    });
  });

  describe('getAllForNode()', () => {
    it('returns both incoming and outgoing edges to/from the node', async () => {
      await store.set([
        edge('a', 'b'), // outgoing from b's perspective: no; outgoing from a
        edge('c', 'b'), // incoming to b
        edge('b', 'd'), // outgoing from b
        edge('x', 'y'), // unrelated
      ]);
      const hits = await store.getAllForNode('b');
      const pairs = hits.map((h) => `${h.sourceId}->${h.targetId}`).sort();
      expect(pairs).toEqual(['a->b', 'b->d', 'c->b']);
    });

    it('returns [] when the node has no inferred edges', async () => {
      await store.set([edge('a', 'b'), edge('c', 'd')]);
      const hits = await store.getAllForNode('z');
      expect(hits).toEqual([]);
    });
  });

  describe('getAll() snapshot semantics', () => {
    it('returns every stored edge', async () => {
      const edges = [edge('a', 'b'), edge('c', 'd'), edge('e', 'f')];
      await store.set(edges);
      const all = await store.getAll();
      expect(all).toHaveLength(3);
      const pairs = all.map((e) => `${e.sourceId}->${e.targetId}`).sort();
      expect(pairs).toEqual(['a->b', 'c->d', 'e->f']);
    });

    it('returns a fresh array each call so caller mutations do not affect the store', async () => {
      await store.set([edge('a', 'b'), edge('c', 'd')]);
      const first = await store.getAll();
      first.length = 0;
      first.push(edge('z', 'z'));
      const second = await store.getAll();
      expect(second).toHaveLength(2);
      const pairs = second.map((e) => `${e.sourceId}->${e.targetId}`).sort();
      expect(pairs).toEqual(['a->b', 'c->d']);
    });
  });

  describe('set() replaces (not merge)', () => {
    it('replaces the entire set on each call', async () => {
      await store.set([edge('a', 'b'), edge('c', 'd')]);
      await store.set([edge('e', 'f')]);
      const all = await store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].sourceId).toBe('e');
      expect(all[0].targetId).toBe('f');
      expect(await store.get('a', 'b')).toBeUndefined();
      expect(await store.get('c', 'd')).toBeUndefined();
    });

    it('collapses duplicate (source,target) pairs within one set call to last-wins', async () => {
      await store.set([
        edge('a', 'b', { score: 0.1, type: 'first' }),
        edge('a', 'b', { score: 0.9, type: 'second' }),
      ]);
      const all = await store.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].score).toBeCloseTo(0.9, 10);
      expect(all[0].type).toBe('second');
    });

    it('treats an empty set as a full clear', async () => {
      await store.set([edge('a', 'b'), edge('c', 'd')]);
      await store.set([]);
      const all = await store.getAll();
      expect(all).toEqual([]);
    });
  });

  describe('clear()', () => {
    it('empties the store', async () => {
      await store.set([edge('a', 'b'), edge('c', 'd')]);
      await store.clear();
      const all = await store.getAll();
      expect(all).toEqual([]);
      expect(await store.get('a', 'b')).toBeUndefined();
    });
  });

  describe('optional fields', () => {
    it('round-trips reasoning and perSource intact', async () => {
      const e: InferredEdge = {
        sourceId: 'a',
        targetId: 'b',
        type: 'related_to',
        score: 0.83,
        sources: ['graph', 'embedding', 'llm'],
        reasoning: 'Both appear in the same narrative arc and share two participants.',
        perSource: {
          graph: { rank: 2, raw: 0.41 },
          embedding: { rank: 1, raw: 0.88 },
          llm: { rank: 3, raw: 0.7 },
        },
      };
      await store.set([e]);
      const hit = await store.get('a', 'b');
      expect(hit).toBeDefined();
      expect(hit!.reasoning).toBe(
        'Both appear in the same narrative arc and share two participants.',
      );
      expect(hit!.sources).toEqual(['graph', 'embedding', 'llm']);
      expect(hit!.perSource?.graph).toEqual({ rank: 2, raw: 0.41 });
      expect(hit!.perSource?.embedding).toEqual({ rank: 1, raw: 0.88 });
      expect(hit!.perSource?.llm).toEqual({ rank: 3, raw: 0.7 });
    });
  });
});

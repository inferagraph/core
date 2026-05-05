import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../../src/store/GraphStore.js';
import {
  computeGraphInferences,
  type GraphInferenceCandidate,
} from '../../../src/ai/inference/graph.js';

function attrs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'x', ...extra };
}

function pair(c: GraphInferenceCandidate): string {
  return `${c.sourceId}->${c.targetId}`;
}

describe('computeGraphInferences', () => {
  describe('empty / trivial graphs', () => {
    it('returns [] on an empty graph', () => {
      const store = new GraphStore();
      expect(computeGraphInferences(store)).toEqual([]);
    });

    it('returns [] on a single-node graph', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      expect(computeGraphInferences(store)).toEqual([]);
    });

    it('returns [] when all nodes are isolated', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      expect(computeGraphInferences(store)).toEqual([]);
    });

    it('returns [] when only a single edge exists (no shared neighbors, no 2-hop reach)', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addEdge('e1', 'a', 'b', { type: 'related' });
      const out = computeGraphInferences(store);
      // a-b is explicit (length 1). They have no common neighbor. Filtered.
      expect(out).toEqual([]);
    });
  });

  describe('common-neighbor signal', () => {
    it('emits common_neighbor for two nodes sharing a neighbor', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store);
      const cn = out.filter((o) => o.signal === 'common_neighbor');
      const pairs = cn.map(pair).sort();
      expect(pairs).toContain('a->b');
      expect(pairs).toContain('b->a');
    });

    it('respects minCommonNeighbors threshold', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store, { minCommonNeighbors: 2 });
      const cn = out.filter((o) => o.signal === 'common_neighbor');
      expect(cn).toEqual([]);
    });

    it('common_neighbor score is shared / max-degree', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addNode('d', attrs());
      // a's neighbors: c, d (deg 2)
      // b's neighbors: c (deg 1)
      // shared: c (1)
      // max deg = 2; expected score = 0.5
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'a', 'd', { type: 'r' });
      store.addEdge('e3', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store);
      const ab = out.find((o) => o.sourceId === 'a' && o.targetId === 'b' && o.signal === 'common_neighbor');
      expect(ab).toBeDefined();
      expect(ab!.score).toBeCloseTo(0.5, 6);
    });
  });

  describe('jaccard signal', () => {
    it('jaccard score = |intersection| / |union|', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addNode('d', attrs());
      store.addNode('e', attrs());
      // N(a) = {c, d}, N(b) = {c, e}. Intersection={c}=1, union={c,d,e}=3. Jaccard = 1/3.
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'a', 'd', { type: 'r' });
      store.addEdge('e3', 'b', 'c', { type: 'r' });
      store.addEdge('e4', 'b', 'e', { type: 'r' });
      const out = computeGraphInferences(store);
      const ab = out.find(
        (o) => o.sourceId === 'a' && o.targetId === 'b' && o.signal === 'jaccard',
      );
      expect(ab).toBeDefined();
      expect(ab!.score).toBeCloseTo(1 / 3, 6);
    });

    it('jaccard reaches 1.0 for identical neighbor sets', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addNode('d', attrs());
      // N(a) = N(b) = {c, d}.
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'a', 'd', { type: 'r' });
      store.addEdge('e3', 'b', 'c', { type: 'r' });
      store.addEdge('e4', 'b', 'd', { type: 'r' });
      const out = computeGraphInferences(store);
      const ab = out.find(
        (o) => o.sourceId === 'a' && o.targetId === 'b' && o.signal === 'jaccard',
      );
      expect(ab!.score).toBeCloseTo(1, 6);
    });
  });

  describe('structural cosine signal', () => {
    it('cosine score = shared / sqrt(deg(u) * deg(v))', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addNode('d', attrs());
      // N(a) = {c, d} (deg 2), N(b) = {c} (deg 1). Shared = 1. Cosine = 1 / sqrt(2) ≈ 0.7071.
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'a', 'd', { type: 'r' });
      store.addEdge('e3', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store);
      const ab = out.find(
        (o) => o.sourceId === 'a' && o.targetId === 'b' && o.signal === 'structural_cosine',
      );
      expect(ab!.score).toBeCloseTo(1 / Math.sqrt(2), 6);
    });
  });

  describe('transitive signal', () => {
    it('emits transitive (length 2) candidates with decay^1', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      // a -- b -- c. a->c is 2 hops.
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store, { transitiveDecay: 0.5 });
      const ac = out.find(
        (o) => o.sourceId === 'a' && o.targetId === 'c' && o.signal === 'transitive',
      );
      expect(ac).toBeDefined();
      expect(ac!.score).toBeCloseTo(0.5, 6);
    });

    it('emits transitive (length 3) candidates with decay^2', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addNode('d', attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      store.addEdge('e3', 'c', 'd', { type: 'r' });
      const out = computeGraphInferences(store, { transitiveDecay: 0.5 });
      const ad = out.find(
        (o) => o.sourceId === 'a' && o.targetId === 'd' && o.signal === 'transitive',
      );
      expect(ad).toBeDefined();
      expect(ad!.score).toBeCloseTo(0.25, 6);
    });

    it('does not emit transitive for length-1 (already explicit)', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      const out = computeGraphInferences(store);
      const ab = out.find(
        (o) => o.sourceId === 'a' && o.targetId === 'b' && o.signal === 'transitive',
      );
      expect(ab).toBeUndefined();
    });

    it('does not emit transitive for self-pairs', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      // a-b-a is a 2-cycle reaching self at distance 2; we exclude self-pairs.
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      const out = computeGraphInferences(store);
      const aa = out.find((o) => o.sourceId === 'a' && o.targetId === 'a');
      expect(aa).toBeUndefined();
    });

    it('decay tunable: decay=0 disables transitive entirely', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store, { transitiveDecay: 0 });
      expect(out.filter((o) => o.signal === 'transitive')).toEqual([]);
    });
  });

  describe('limitPerNode cap', () => {
    it('caps candidates per source node to limitPerNode', () => {
      // Star graph: center plus many leaves, each leaf shares the center
      // with every other leaf -> O(leaves^2) candidates pre-cap.
      const store = new GraphStore();
      store.addNode('center', attrs());
      for (let i = 0; i < 10; i++) {
        store.addNode(`leaf-${i}`, attrs());
        store.addEdge(`e-${i}`, 'center', `leaf-${i}`, { type: 'r' });
      }
      const out = computeGraphInferences(store, { limitPerNode: 3 });
      const bySrc = new Map<string, number>();
      for (const c of out) {
        bySrc.set(c.sourceId, (bySrc.get(c.sourceId) ?? 0) + 1);
      }
      for (const count of bySrc.values()) {
        expect(count).toBeLessThanOrEqual(3);
      }
    });

    it('limitPerNode=0 returns []', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addEdge('e1', 'a', 'c', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store, { limitPerNode: 0 });
      expect(out).toEqual([]);
    });
  });

  describe('isolated nodes', () => {
    it('skips isolated nodes — never appear as source or target', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addNode('alone', attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store);
      const involvesAlone = out.some(
        (o) => o.sourceId === 'alone' || o.targetId === 'alone',
      );
      expect(involvesAlone).toBe(false);
    });
  });

  describe('output shape', () => {
    it('every candidate has signal in the locked set', () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      store.addNode('b', attrs());
      store.addNode('c', attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      const out = computeGraphInferences(store);
      const allowed = new Set([
        'common_neighbor',
        'jaccard',
        'structural_cosine',
        'transitive',
      ]);
      for (const c of out) {
        expect(allowed.has(c.signal)).toBe(true);
      }
    });

    it('every candidate has score in [0, 1]', () => {
      const store = new GraphStore();
      // Larger graph to exercise multiple signals together.
      for (const id of ['a', 'b', 'c', 'd', 'e']) store.addNode(id, attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'a', 'c', { type: 'r' });
      store.addEdge('e3', 'b', 'd', { type: 'r' });
      store.addEdge('e4', 'c', 'd', { type: 'r' });
      store.addEdge('e5', 'd', 'e', { type: 'r' });
      const out = computeGraphInferences(store);
      for (const c of out) {
        expect(c.score).toBeGreaterThanOrEqual(0);
        expect(c.score).toBeLessThanOrEqual(1);
      }
    });

    it('never emits self-pairs', () => {
      const store = new GraphStore();
      for (const id of ['a', 'b', 'c']) store.addNode(id, attrs());
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      store.addEdge('e2', 'b', 'c', { type: 'r' });
      store.addEdge('e3', 'a', 'c', { type: 'r' });
      const out = computeGraphInferences(store);
      for (const c of out) {
        expect(c.sourceId).not.toBe(c.targetId);
      }
    });
  });
});

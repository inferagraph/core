import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../../src/store/GraphStore.js';
import { inMemoryEmbeddingStore } from '../../../src/ai/InMemoryEmbeddingStore.js';
import { contentHash, type EmbeddingRecord, type Vector } from '../../../src/ai/Embedding.js';
import { embeddingText } from '../../../src/ai/SchemaInspector.js';
import { computeEmbeddingInferences } from '../../../src/ai/inference/embedding.js';

function attrs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'x', ...extra };
}

function l2(v: Vector): Vector {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v.slice();
  return v.map((x) => x / mag);
}

/**
 * Build a store with `n` nodes and a vector map. Vectors are L2-normalised
 * by this helper so cosine similarity reduces to a dot product.
 */
function buildFixture(): {
  store: GraphStore;
  vectors: Map<string, Vector>;
  records: EmbeddingRecord[];
} {
  const store = new GraphStore();
  // Three node groups with crafted vectors:
  //   a, b → very similar (cos ~ 0.99)
  //   c    → orthogonal to (a,b)
  //   d    → opposite to (a,b) (cos ~ -1)
  store.addNode('a', attrs({ kind: 'first' }));
  store.addNode('b', attrs({ kind: 'second' }));
  store.addNode('c', attrs({ kind: 'third' }));
  store.addNode('d', attrs({ kind: 'fourth' }));

  const va = l2([1, 0, 0, 0]);
  const vb = l2([0.99, 0.1, 0, 0]); // cos(va,vb) ≈ 0.995
  const vc = l2([0, 1, 0, 0]); // cos(va,vc) = 0
  const vd = l2([-1, 0, 0, 0]); // cos(va,vd) = -1
  const vectors = new Map<string, Vector>([
    ['a', va],
    ['b', vb],
    ['c', vc],
    ['d', vd],
  ]);

  // Build embedding records keyed by content hash so the Tier 3 path can
  // find them via `embeddingStore.get`.
  const records: EmbeddingRecord[] = [];
  for (const node of store.getAllNodes()) {
    const hash = contentHash(embeddingText({ id: node.id, attributes: node.attributes }));
    records.push({
      nodeId: node.id,
      vector: vectors.get(node.id)!,
      meta: {
        model: 'test',
        modelVersion: '',
        generatedAt: '2026-01-01T00:00:00Z',
        contentHash: hash,
      },
    });
  }

  return { store, vectors, records };
}

describe('computeEmbeddingInferences', () => {
  describe('degraded paths', () => {
    it('returns [] when neither embeddingStore nor cacheRecords is set (Tier 1)', async () => {
      const { store } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        model: 'test',
        modelVersion: '',
      });
      expect(out).toEqual([]);
    });

    it('returns [] on a single-node graph', async () => {
      const store = new GraphStore();
      store.addNode('a', attrs());
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: [
          {
            nodeId: 'a',
            vector: l2([1, 0]),
            meta: { model: 'test', modelVersion: '', generatedAt: '', contentHash: 'h' },
          },
        ],
        model: 'test',
        modelVersion: '',
      });
      expect(out).toEqual([]);
    });

    it('returns [] when limitPerNode is 0', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        limitPerNode: 0,
      });
      expect(out).toEqual([]);
    });

    it('returns [] when signal is pre-aborted', async () => {
      const { store, records } = buildFixture();
      const ac = new AbortController();
      ac.abort();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        signal: ac.signal,
      });
      expect(out).toEqual([]);
    });
  });

  describe('Tier 2 (cacheRecords)', () => {
    it('produces high-similarity pairs via crafted vectors', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        minSimilarity: 0.5, // accept the ~0.99 a-b pair
      });
      const pairs = out.map((c) => `${c.sourceId}->${c.targetId}`).sort();
      expect(pairs).toContain('a->b');
      expect(pairs).toContain('b->a');
    });

    it('drops pairs below minSimilarity', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        minSimilarity: 0.9, // keeps a-b (0.995) but drops a-c (0.0) and a-d (-1)
      });
      const involvesAD = out.some(
        (c) =>
          (c.sourceId === 'a' && c.targetId === 'd') ||
          (c.sourceId === 'd' && c.targetId === 'a'),
      );
      const involvesAC = out.some(
        (c) =>
          (c.sourceId === 'a' && c.targetId === 'c') ||
          (c.sourceId === 'c' && c.targetId === 'a'),
      );
      expect(involvesAD).toBe(false);
      expect(involvesAC).toBe(false);
    });

    it('never emits self-pairs', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        minSimilarity: -2,
      });
      for (const c of out) {
        expect(c.sourceId).not.toBe(c.targetId);
      }
    });

    it('respects limitPerNode', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        limitPerNode: 1,
        minSimilarity: -2,
      });
      const counts = new Map<string, number>();
      for (const c of out) {
        counts.set(c.sourceId, (counts.get(c.sourceId) ?? 0) + 1);
      }
      for (const v of counts.values()) {
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('orders top hit per source by descending similarity', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        limitPerNode: 1,
        minSimilarity: -2,
      });
      // For source `a`: best target should be `b` (cos ~0.995)
      const aTop = out.find((c) => c.sourceId === 'a');
      expect(aTop).toBeDefined();
      expect(aTop!.targetId).toBe('b');
    });

    it('produces score = cosine similarity (range [-1, 1])', async () => {
      const { store, records } = buildFixture();
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        minSimilarity: -2,
      });
      for (const c of out) {
        expect(c.score).toBeGreaterThanOrEqual(-1.0001);
        expect(c.score).toBeLessThanOrEqual(1.0001);
      }
    });

    it('skips nodes without a vector record', async () => {
      const { store, records } = buildFixture();
      // Drop record for "c" -> shouldn't appear as source.
      const partial = records.filter((r) => r.nodeId !== 'c');
      const out = await computeEmbeddingInferences({
        store,
        cacheRecords: partial,
        model: 'test',
        modelVersion: '',
        minSimilarity: -2,
      });
      const cAsSource = out.some((c) => c.sourceId === 'c');
      const cAsTarget = out.some((c) => c.targetId === 'c');
      expect(cAsSource).toBe(false);
      expect(cAsTarget).toBe(false);
    });
  });

  describe('Tier 3 (embeddingStore)', () => {
    it('produces results via the embeddingStore.similar path', async () => {
      const { store, records } = buildFixture();
      const estore = inMemoryEmbeddingStore();
      for (const r of records) await estore.set(r);
      const out = await computeEmbeddingInferences({
        store,
        embeddingStore: estore,
        model: 'test',
        modelVersion: '',
        minSimilarity: 0.5,
      });
      const pairs = out.map((c) => `${c.sourceId}->${c.targetId}`).sort();
      expect(pairs).toContain('a->b');
    });

    it('respects minSimilarity in Tier 3', async () => {
      const { store, records } = buildFixture();
      const estore = inMemoryEmbeddingStore();
      for (const r of records) await estore.set(r);
      const out = await computeEmbeddingInferences({
        store,
        embeddingStore: estore,
        model: 'test',
        modelVersion: '',
        minSimilarity: 0.99, // only keep the very-similar a-b pair
      });
      // Every emitted candidate must have score >= 0.99.
      for (const c of out) {
        expect(c.score).toBeGreaterThanOrEqual(0.99);
      }
    });

    it('respects limitPerNode in Tier 3', async () => {
      const { store, records } = buildFixture();
      const estore = inMemoryEmbeddingStore();
      for (const r of records) await estore.set(r);
      const out = await computeEmbeddingInferences({
        store,
        embeddingStore: estore,
        model: 'test',
        modelVersion: '',
        minSimilarity: -2,
        limitPerNode: 2,
      });
      const counts = new Map<string, number>();
      for (const c of out) {
        counts.set(c.sourceId, (counts.get(c.sourceId) ?? 0) + 1);
      }
      for (const v of counts.values()) {
        expect(v).toBeLessThanOrEqual(2);
      }
    });

    it('Tier 3 takes precedence over Tier 2 when both are passed', async () => {
      const { store, records } = buildFixture();
      const estore = inMemoryEmbeddingStore();
      // Empty store — should produce zero results from Tier 3 even when
      // cacheRecords would have produced hits.
      const out = await computeEmbeddingInferences({
        store,
        embeddingStore: estore,
        cacheRecords: records,
        model: 'test',
        modelVersion: '',
        minSimilarity: -2,
      });
      expect(out).toEqual([]);
    });
  });
});

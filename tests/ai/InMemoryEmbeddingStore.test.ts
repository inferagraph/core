import { describe, it, expect, beforeEach } from 'vitest';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import {
  contentHash,
  type EmbeddingRecord,
  type EmbeddingStore,
} from '../../src/ai/Embedding.js';

function record(
  nodeId: string,
  vector: number[],
  overrides?: Partial<EmbeddingRecord['meta']>,
): EmbeddingRecord {
  return {
    nodeId,
    vector,
    meta: {
      model: overrides?.model ?? 'mock',
      modelVersion: overrides?.modelVersion ?? '',
      generatedAt: overrides?.generatedAt ?? '2026-04-30T00:00:00.000Z',
      contentHash: overrides?.contentHash ?? contentHash(nodeId),
    },
  };
}

describe('inMemoryEmbeddingStore', () => {
  let store: EmbeddingStore;

  beforeEach(() => {
    store = inMemoryEmbeddingStore();
  });

  describe('get / set roundtrip', () => {
    it('returns undefined when nothing is stored', async () => {
      const hit = await store.get('a', 'mock', '', '00');
      expect(hit).toBeUndefined();
    });

    it('persists and retrieves by composite key', async () => {
      const r = record('a', [1, 0, 0]);
      await store.set(r);
      const hit = await store.get('a', r.meta.model, r.meta.modelVersion, r.meta.contentHash);
      expect(hit).toBeDefined();
      expect(hit!.nodeId).toBe('a');
      expect(hit!.vector).toEqual([1, 0, 0]);
    });

    it('returns undefined when contentHash does not match (cache-buster)', async () => {
      const r = record('a', [1, 0, 0]);
      await store.set(r);
      const hit = await store.get('a', r.meta.model, r.meta.modelVersion, 'differenthash000');
      expect(hit).toBeUndefined();
    });

    it('returns undefined when model does not match', async () => {
      const r = record('a', [1, 0, 0], { model: 'mock' });
      await store.set(r);
      const hit = await store.get('a', 'other-model', '', r.meta.contentHash);
      expect(hit).toBeUndefined();
    });

    it('returns undefined when modelVersion does not match', async () => {
      const r = record('a', [1, 0, 0], { modelVersion: 'v1' });
      await store.set(r);
      const hit = await store.get('a', r.meta.model, 'v2', r.meta.contentHash);
      expect(hit).toBeUndefined();
    });

    it('keeps separate entries for the same nodeId across model versions', async () => {
      const v1 = record('a', [1, 0, 0], { modelVersion: 'v1' });
      const v2 = record('a', [0, 1, 0], { modelVersion: 'v2' });
      await store.set(v1);
      await store.set(v2);
      const hitV1 = await store.get('a', 'mock', 'v1', v1.meta.contentHash);
      const hitV2 = await store.get('a', 'mock', 'v2', v2.meta.contentHash);
      expect(hitV1!.vector).toEqual([1, 0, 0]);
      expect(hitV2!.vector).toEqual([0, 1, 0]);
    });

    it('overwrites on duplicate composite key', async () => {
      const r1 = record('a', [1, 0, 0]);
      const r2 = record('a', [9, 9, 9]);
      await store.set(r1);
      await store.set(r2);
      const hit = await store.get('a', r1.meta.model, r1.meta.modelVersion, r1.meta.contentHash);
      expect(hit!.vector).toEqual([9, 9, 9]);
    });

    it('clones vectors so caller mutations do not bleed in', async () => {
      const v = [1, 0, 0];
      const r = record('a', v);
      await store.set(r);
      v[0] = 999;
      const hit = await store.get('a', r.meta.model, r.meta.modelVersion, r.meta.contentHash);
      expect(hit!.vector).toEqual([1, 0, 0]);
    });
  });

  describe('similar()', () => {
    it('ranks by descending cosine similarity', async () => {
      await store.set(record('a', [1, 0, 0]));
      await store.set(record('b', [0.9, 0.1, 0]));
      await store.set(record('c', [0, 1, 0]));
      const hits = await store.similar([1, 0, 0], 3);
      expect(hits[0].nodeId).toBe('a');
      expect(hits[1].nodeId).toBe('b');
      expect(hits[2].nodeId).toBe('c');
      expect(hits[0].score).toBeGreaterThan(hits[1].score);
      expect(hits[1].score).toBeGreaterThan(hits[2].score);
    });

    it('honors k', async () => {
      await store.set(record('a', [1, 0, 0]));
      await store.set(record('b', [0.9, 0.1, 0]));
      await store.set(record('c', [0, 1, 0]));
      const hits = await store.similar([1, 0, 0], 2);
      expect(hits).toHaveLength(2);
      expect(hits.map((h) => h.nodeId)).toEqual(['a', 'b']);
    });

    it('returns [] when k <= 0', async () => {
      await store.set(record('a', [1, 0, 0]));
      const hits = await store.similar([1, 0, 0], 0);
      expect(hits).toEqual([]);
    });

    it('filters by model when supplied', async () => {
      await store.set(record('a', [1, 0, 0], { model: 'mock' }));
      await store.set(record('b', [1, 0, 0], { model: 'other' }));
      const hits = await store.similar([1, 0, 0], 5, 'mock');
      expect(hits.map((h) => h.nodeId)).toEqual(['a']);
    });

    it('filters by modelVersion when supplied', async () => {
      await store.set(record('a', [1, 0, 0], { modelVersion: 'v1' }));
      await store.set(record('b', [1, 0, 0], { modelVersion: 'v2' }));
      const hits = await store.similar([1, 0, 0], 5, '', 'v2');
      expect(hits.map((h) => h.nodeId)).toEqual(['b']);
    });

    it('skips entries whose vector length mismatches the query', async () => {
      await store.set(record('a', [1, 0, 0]));
      await store.set(record('b', [1, 0]));
      const hits = await store.similar([1, 0, 0], 5);
      expect(hits.map((h) => h.nodeId)).toEqual(['a']);
    });

    it('collapses duplicate nodeIds (different content hashes) to best score', async () => {
      await store.set(record('a', [1, 0, 0], { contentHash: 'h1' }));
      await store.set(record('a', [0.5, 0.5, 0], { contentHash: 'h2' }));
      const hits = await store.similar([1, 0, 0], 5);
      expect(hits).toHaveLength(1);
      expect(hits[0].nodeId).toBe('a');
      expect(hits[0].score).toBeCloseTo(1, 10);
    });
  });

  describe('clear()', () => {
    it('removes every entry', async () => {
      await store.set(record('a', [1, 0, 0]));
      await store.set(record('b', [0, 1, 0]));
      await store.clear();
      const hits = await store.similar([1, 0, 0], 5);
      expect(hits).toEqual([]);
    });
  });
});

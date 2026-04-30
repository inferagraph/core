import { describe, it, expect } from 'vitest';
import {
  mockLLMProvider,
  deterministicVector,
} from '../../src/ai/MockLLMProvider.js';
import { cosineSimilarity } from '../../src/ai/Embedding.js';

describe('mockLLMProvider.embed', () => {
  describe('default (deterministic) source', () => {
    it('produces a 32-dim vector for any text', async () => {
      const provider = mockLLMProvider({});
      const [v] = await provider.embed(['hello']);
      expect(v).toHaveLength(32);
    });

    it('returns the same vector for the same text', async () => {
      const provider = mockLLMProvider({});
      const [a] = await provider.embed(['hello']);
      const [b] = await provider.embed(['hello']);
      expect(a).toEqual(b);
    });

    it('returns DIFFERENT vectors for different text', async () => {
      const provider = mockLLMProvider({});
      const [a] = await provider.embed(['hello']);
      const [b] = await provider.embed(['world']);
      expect(a).not.toEqual(b);
    });

    it('preserves input order in the output batch', async () => {
      const provider = mockLLMProvider({});
      const vectors = await provider.embed(['a', 'b', 'c']);
      expect(vectors).toHaveLength(3);
      expect(vectors[0]).toEqual(deterministicVector('a'));
      expect(vectors[1]).toEqual(deterministicVector('b'));
      expect(vectors[2]).toEqual(deterministicVector('c'));
    });

    it('produces unit-norm vectors', async () => {
      const provider = mockLLMProvider({});
      const [v] = await provider.embed(['hello']);
      const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
      expect(mag).toBeCloseTo(1, 6);
    });

    it('cosine similarity between identical texts is 1', async () => {
      const provider = mockLLMProvider({});
      const [a] = await provider.embed(['hello']);
      const [b] = await provider.embed(['hello']);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    });
  });

  describe('map source', () => {
    it('uses canned vectors for matching texts', async () => {
      const canned = { hello: [1, 0, 0], world: [0, 1, 0] };
      const provider = mockLLMProvider({}, canned);
      const vectors = await provider.embed(['hello', 'world']);
      expect(vectors[0]).toEqual([1, 0, 0]);
      expect(vectors[1]).toEqual([0, 1, 0]);
    });

    it('falls back to deterministic for missing keys', async () => {
      const provider = mockLLMProvider({}, { hello: [1, 0, 0] });
      const vectors = await provider.embed(['hello', 'unmapped']);
      expect(vectors[0]).toEqual([1, 0, 0]);
      expect(vectors[1]).toHaveLength(32);
    });

    it('clones canned vectors so caller mutations are isolated', async () => {
      const canned = { hello: [1, 0, 0] };
      const provider = mockLLMProvider({}, canned);
      const [v] = await provider.embed(['hello']);
      v[0] = 999;
      const [again] = await provider.embed(['hello']);
      expect(again).toEqual([1, 0, 0]);
    });
  });

  describe('function source', () => {
    it('invokes the function once per text', async () => {
      const calls: string[] = [];
      const provider = mockLLMProvider({}, (t) => {
        calls.push(t);
        return [t.length];
      });
      const vectors = await provider.embed(['a', 'bb', 'ccc']);
      expect(calls).toEqual(['a', 'bb', 'ccc']);
      expect(vectors).toEqual([[1], [2], [3]]);
    });

    it('supports async functions', async () => {
      const provider = mockLLMProvider({}, async (t) => {
        await Promise.resolve();
        return [t.length];
      });
      const vectors = await provider.embed(['hi']);
      expect(vectors).toEqual([[2]]);
    });
  });

  describe('inspection helpers', () => {
    it('tracks embed call count', async () => {
      const provider = mockLLMProvider({});
      expect(provider.getEmbedCallCount()).toBe(0);
      await provider.embed(['a']);
      await provider.embed(['b']);
      expect(provider.getEmbedCallCount()).toBe(2);
    });

    it('tracks the last embed batch', async () => {
      const provider = mockLLMProvider({});
      await provider.embed(['x', 'y', 'z']);
      expect(provider.getLastEmbedBatch()).toEqual(['x', 'y', 'z']);
    });

    it('reset() clears embed state', async () => {
      const provider = mockLLMProvider({});
      await provider.embed(['x']);
      provider.reset();
      expect(provider.getEmbedCallCount()).toBe(0);
      expect(provider.getLastEmbedBatch()).toBeUndefined();
    });
  });

  describe('signal handling', () => {
    it('rejects with AbortError when signal is pre-aborted', async () => {
      const provider = mockLLMProvider({});
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(provider.embed(['hi'], { signal: ctrl.signal })).rejects.toThrow();
    });
  });
});

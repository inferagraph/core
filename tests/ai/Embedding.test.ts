import { describe, it, expect } from 'vitest';
import {
  contentHash,
  cosineSimilarity,
  type EmbeddingRecord,
  type EmbeddingStore,
} from '../../src/ai/Embedding.js';

describe('Embedding types and helpers', () => {
  describe('contentHash', () => {
    it('produces a stable 16-char hex string for the same input', () => {
      const a = contentHash('hello');
      const b = contentHash('hello');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces distinct hashes for distinct inputs', () => {
      expect(contentHash('hello')).not.toBe(contentHash('world'));
      expect(contentHash('hello')).not.toBe(contentHash('hello!'));
    });

    it('hashes the empty string deterministically', () => {
      expect(contentHash('')).toBe(contentHash(''));
      expect(contentHash('')).toMatch(/^[0-9a-f]{16}$/);
    });

    it('handles unicode input without throwing', () => {
      expect(() => contentHash('hello \u{1f44b} world')).not.toThrow();
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
    });

    it('returns -1 for opposing vectors', () => {
      expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    });

    it('returns 0 when either side is empty', () => {
      expect(cosineSimilarity([], [1, 2])).toBe(0);
      expect(cosineSimilarity([1, 2], [])).toBe(0);
    });

    it('returns NaN on length mismatch (not a throw)', () => {
      expect(Number.isNaN(cosineSimilarity([1, 2], [1, 2, 3]))).toBe(true);
    });

    it('returns 0 when one side is the zero vector', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
    });
  });

  describe('EmbeddingRecord shape', () => {
    it('TypeScript accepts a fully-populated record', () => {
      const record: EmbeddingRecord = {
        nodeId: 'n1',
        vector: [0.1, 0.2, 0.3],
        meta: {
          model: 'text-embedding-3-small',
          modelVersion: '1',
          generatedAt: new Date().toISOString(),
          contentHash: contentHash('test'),
        },
      };
      expect(record.nodeId).toBe('n1');
      expect(record.vector).toHaveLength(3);
      expect(record.meta.contentHash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('EmbeddingStore is a structural interface (no required fields beyond methods)', () => {
      // Compile-time check: a literal object satisfies the interface.
      const store: EmbeddingStore = {
        async get() {
          return undefined;
        },
        async set() {
          /* noop */
        },
        async similar() {
          return [];
        },
        async clear() {
          /* noop */
        },
      };
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.similar).toBe('function');
      expect(typeof store.clear).toBe('function');
    });
  });
});

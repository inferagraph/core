import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../../src/store/GraphStore.js';
import { mergeInferences } from '../../../src/ai/inference/merge.js';
import type { GraphInferenceCandidate } from '../../../src/ai/inference/graph.js';
import type { EmbeddingInferenceCandidate } from '../../../src/ai/inference/embedding.js';
import type { LLMInferenceCandidate } from '../../../src/ai/inference/llm.js';

function freshStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('a', { name: 'A' });
  store.addNode('b', { name: 'B' });
  store.addNode('c', { name: 'C' });
  store.addNode('d', { name: 'D' });
  return store;
}

describe('mergeInferences', () => {
  describe('empty inputs', () => {
    it('returns [] when all signal lists are empty', () => {
      const store = freshStore();
      const out = mergeInferences(store, [], [], []);
      expect(out).toEqual([]);
    });

    it('handles single-signal input', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.7, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out).toHaveLength(1);
      expect(out[0].sources).toEqual(['graph']);
      expect(out[0].sourceId).toBe('a');
      expect(out[0].targetId).toBe('b');
    });
  });

  describe('explicit-edge dedup (the keystone)', () => {
    it('drops candidates that match an existing edge in the same direction', () => {
      const store = freshStore();
      store.addEdge('e1', 'a', 'b', { type: 'father_of_x' }); // explicit edge a->b
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.9, signal: 'common_neighbor' },
        { sourceId: 'c', targetId: 'd', score: 0.8, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      const pairs = out.map((e) => `${e.sourceId}->${e.targetId}`);
      expect(pairs).not.toContain('a->b');
      expect(pairs).toContain('c->d');
    });

    it('drops candidates whose REVERSE direction is already an explicit edge', () => {
      const store = freshStore();
      store.addEdge('e1', 'b', 'a', { type: 'r' }); // explicit b->a
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.9, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out).toEqual([]);
    });

    it('drops both directions when explicit edge exists', () => {
      const store = freshStore();
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.9, signal: 'common_neighbor' },
        { sourceId: 'b', targetId: 'a', score: 0.85, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out).toEqual([]);
    });

    it('excludeExplicit: false keeps explicit-pair candidates', () => {
      const store = freshStore();
      store.addEdge('e1', 'a', 'b', { type: 'r' });
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.9, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], [], { excludeExplicit: false });
      expect(out).toHaveLength(1);
      expect(out[0].sourceId).toBe('a');
      expect(out[0].targetId).toBe('b');
    });
  });

  describe('multi-source dedup', () => {
    it('merges same (source, target) across signals into a single edge with sources union', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.7, signal: 'common_neighbor' },
      ];
      const embed: EmbeddingInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.9 },
      ];
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', type: 'shares_setting_with', confidence: 0.8 },
      ];
      const out = mergeInferences(store, graph, embed, llm);
      expect(out).toHaveLength(1);
      expect(out[0].sources).toEqual(['graph', 'embedding', 'llm']);
    });

    it('picks the LLM-emitted type when LLM contributed', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.7, signal: 'common_neighbor' },
      ];
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', type: 'shares_setting_with', confidence: 0.8 },
      ];
      const out = mergeInferences(store, graph, [], llm);
      expect(out).toHaveLength(1);
      expect(out[0].type).toBe('shares_setting_with');
    });

    it('falls back to "related_to" when LLM did not contribute', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.7, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out[0].type).toBe('related_to');
    });

    it('attaches LLM reasoning only when LLM contributed', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.5, signal: 'common_neighbor' },
        { sourceId: 'c', targetId: 'd', score: 0.5, signal: 'common_neighbor' },
      ];
      const llm: LLMInferenceCandidate[] = [
        {
          sourceId: 'a',
          targetId: 'b',
          type: 't',
          confidence: 0.7,
          reasoning: 'because reasons',
        },
      ];
      const out = mergeInferences(store, graph, [], llm);
      const ab = out.find((e) => e.sourceId === 'a' && e.targetId === 'b');
      const cd = out.find((e) => e.sourceId === 'c' && e.targetId === 'd');
      expect(ab!.reasoning).toBe('because reasons');
      expect(cd!.reasoning).toBeUndefined();
    });

    it('treats (a,b) and (b,a) as DISTINCT pairs', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.5, signal: 'common_neighbor' },
        { sourceId: 'b', targetId: 'a', score: 0.5, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out).toHaveLength(2);
      const pairs = out.map((e) => `${e.sourceId}->${e.targetId}`).sort();
      expect(pairs).toEqual(['a->b', 'b->a']);
    });
  });

  describe('RRF correctness', () => {
    it('multi-signal pair scores higher than single-signal pair', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.5, signal: 'common_neighbor' },
        { sourceId: 'c', targetId: 'd', score: 0.5, signal: 'common_neighbor' },
      ];
      const embed: EmbeddingInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.5 },
      ];
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', type: 't', confidence: 0.5 },
      ];
      const out = mergeInferences(store, graph, embed, llm);
      const ab = out.find((e) => e.sourceId === 'a' && e.targetId === 'b')!;
      const cd = out.find((e) => e.sourceId === 'c' && e.targetId === 'd')!;
      expect(ab.score).toBeGreaterThan(cd.score);
      // ab has 3 sources, score should be ~1.0; cd has 1, score ~0.33.
      expect(ab.score).toBeGreaterThan(0.9);
      expect(cd.score).toBeLessThan(0.4);
    });

    it('output is sorted by descending score', () => {
      const store = freshStore();
      // c-d signal x3, a-b signal x1
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.99, signal: 'common_neighbor' },
        { sourceId: 'c', targetId: 'd', score: 0.5, signal: 'common_neighbor' },
      ];
      const embed: EmbeddingInferenceCandidate[] = [
        { sourceId: 'c', targetId: 'd', score: 0.5 },
      ];
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'c', targetId: 'd', type: 't', confidence: 0.5 },
      ];
      const out = mergeInferences(store, graph, embed, llm);
      for (let i = 1; i < out.length; i++) {
        expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
      }
    });

    it('every emitted edge has score in [0, 1]', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 1.0, signal: 'common_neighbor' },
        { sourceId: 'a', targetId: 'b', score: 0.9, signal: 'jaccard' },
        { sourceId: 'c', targetId: 'd', score: 0.1, signal: 'transitive' },
      ];
      const embed: EmbeddingInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.95 },
      ];
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', type: 't', confidence: 1 },
      ];
      const out = mergeInferences(store, graph, embed, llm);
      for (const e of out) {
        expect(e.score).toBeGreaterThanOrEqual(0);
        expect(e.score).toBeLessThanOrEqual(1);
      }
    });

    it('rrfK tunable: larger k flattens score differences', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 1.0, signal: 'common_neighbor' },
        { sourceId: 'c', targetId: 'd', score: 0.5, signal: 'common_neighbor' },
      ];
      const small = mergeInferences(store, graph, [], [], { rrfK: 1 });
      const large = mergeInferences(store, graph, [], [], { rrfK: 1000 });
      // Score difference between top and bottom should shrink with larger k.
      const sDiff = small[0].score - small[small.length - 1].score;
      const lDiff = large[0].score - large[large.length - 1].score;
      expect(lDiff).toBeLessThanOrEqual(sDiff);
    });

    it('per-signal collapse: duplicate pairs in one signal use the best raw score', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.3, signal: 'common_neighbor' },
        { sourceId: 'a', targetId: 'b', score: 0.9, signal: 'jaccard' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out).toHaveLength(1);
      // perSource.graph.raw should reflect 0.9, not 0.3.
      expect(out[0].perSource?.graph?.raw).toBeCloseTo(0.9, 6);
    });
  });

  describe('perSource bookkeeping', () => {
    it('attaches rank+raw for each contributing signal', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.7, signal: 'common_neighbor' },
      ];
      const embed: EmbeddingInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.9 },
      ];
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', type: 't', confidence: 0.5 },
      ];
      const out = mergeInferences(store, graph, embed, llm);
      const ab = out[0];
      expect(ab.perSource?.graph?.rank).toBe(1);
      expect(ab.perSource?.embedding?.rank).toBe(1);
      expect(ab.perSource?.llm?.rank).toBe(1);
      expect(ab.perSource?.graph?.raw).toBeCloseTo(0.7, 6);
      expect(ab.perSource?.embedding?.raw).toBeCloseTo(0.9, 6);
      expect(ab.perSource?.llm?.raw).toBeCloseTo(0.5, 6);
    });

    it('omits non-contributing signals from perSource', () => {
      const store = freshStore();
      const graph: GraphInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.7, signal: 'common_neighbor' },
      ];
      const out = mergeInferences(store, graph, [], []);
      expect(out[0].perSource?.graph).toBeDefined();
      expect(out[0].perSource?.embedding).toBeUndefined();
      expect(out[0].perSource?.llm).toBeUndefined();
    });
  });

  describe('canonical sources order', () => {
    it('orders sources as graph, embedding, llm regardless of contribution order', () => {
      const store = freshStore();
      const llm: LLMInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', type: 't', confidence: 0.5 },
      ];
      const embed: EmbeddingInferenceCandidate[] = [
        { sourceId: 'a', targetId: 'b', score: 0.5 },
      ];
      const out = mergeInferences(store, [], embed, llm);
      expect(out[0].sources).toEqual(['embedding', 'llm']);
    });
  });
});

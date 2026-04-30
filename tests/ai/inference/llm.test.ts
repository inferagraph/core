import { describe, it, expect, vi } from 'vitest';
import { GraphStore } from '../../../src/store/GraphStore.js';
import { mockLLMProvider } from '../../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../../src/cache/lruCache.js';
import { SchemaInspector } from '../../../src/ai/SchemaInspector.js';
import {
  buildLLMInferencePrompt,
  computeLLMInferences,
} from '../../../src/ai/inference/llm.js';

function attrs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'item', ...extra };
}

/** Generic graph fixture with no Bible-specific words. */
function genericFixture(): { store: GraphStore; inspector: SchemaInspector } {
  const store = new GraphStore();
  store.addNode('alpha', { name: 'Alpha', kind: 'shape', color: 'red' });
  store.addNode('bravo', { name: 'Bravo', kind: 'shape', color: 'blue' });
  store.addNode('charlie', { name: 'Charlie', kind: 'tool', color: 'red' });
  store.addNode('delta', { name: 'Delta', kind: 'tool', color: 'green' });
  store.addEdge('e1', 'alpha', 'bravo', { type: 'connects_to' });
  store.addEdge('e2', 'bravo', 'charlie', { type: 'connects_to' });
  store.addEdge('e3', 'charlie', 'delta', { type: 'connects_to' });
  return { store, inspector: new SchemaInspector(store) };
}

describe('computeLLMInferences', () => {
  describe('happy path', () => {
    it('parses canned JSON edges and returns candidates', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [
          {
            targetId: 'bravo',
            type: 'connects_to',
            reasoning: 'shared color',
            confidence: 0.9,
          },
        ],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      expect(out.length).toBeGreaterThan(0);
      const sample = out.find((c) => c.targetId === 'bravo');
      expect(sample).toBeDefined();
      expect(sample!.type).toBe('connects_to');
      expect(sample!.confidence).toBeCloseTo(0.9, 6);
      expect(sample!.reasoning).toBe('shared color');
    });

    it('issues one provider call per source node', async () => {
      const { store, inspector } = genericFixture();
      const provider = mockLLMProvider(() =>
        JSON.stringify({ edges: [] }),
      );
      await computeLLMInferences({ store, provider, inspector, schemaSampleSize: 5 });
      // 4 nodes -> 4 complete() calls.
      expect(provider.getCallCount()).toBe(4);
    });

    it('respects limitPerNode bound', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [
          { targetId: 'bravo', type: 't1', confidence: 0.8 },
          { targetId: 'charlie', type: 't2', confidence: 0.7 },
          { targetId: 'delta', type: 't3', confidence: 0.6 },
        ],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
        limitPerNode: 1,
      });
      const counts = new Map<string, number>();
      for (const c of out) counts.set(c.sourceId, (counts.get(c.sourceId) ?? 0) + 1);
      for (const v of counts.values()) expect(v).toBeLessThanOrEqual(1);
    });

    it('clamps confidence into [0, 1]', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [
          { targetId: 'bravo', type: 't', confidence: 5 },
          { targetId: 'charlie', type: 't', confidence: -1 },
          { targetId: 'delta', type: 't', confidence: 'oops' },
        ],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      for (const c of out) {
        expect(c.confidence).toBeGreaterThanOrEqual(0);
        expect(c.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('defaults type to "related_to" when missing or empty', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [{ targetId: 'bravo', confidence: 0.5 }],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      for (const c of out) expect(c.type).toBe('related_to');
    });
  });

  describe('hallucination handling', () => {
    it('drops candidates with unknown target IDs and emits a single warn summary', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [
          { targetId: 'NOT_A_REAL_NODE', type: 't', confidence: 0.5 },
          { targetId: 'bravo', type: 't', confidence: 0.5 },
        ],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      // Only the valid `bravo` targets survive.
      expect(out.every((c) => c.targetId !== 'NOT_A_REAL_NODE')).toBe(true);
      // Exactly one summary warn line.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const args = warnSpy.mock.calls[0]?.[0];
      expect(typeof args).toBe('string');
      expect(args).toMatch(/hallucinated/i);
      warnSpy.mockRestore();
    });

    it('does NOT warn when no hallucinations occurred', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [{ targetId: 'bravo', type: 't', confidence: 0.5 }],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('drops self-pair candidates', async () => {
      const { store, inspector } = genericFixture();
      const provider = mockLLMProvider((p): string => {
        // Source node id appears in the prompt; emit a self-loop for whichever
        // source the prompt names. Cheap heuristic: try `alpha`.
        const targetId = p.includes('id="alpha"') ? 'alpha' : 'bravo';
        return JSON.stringify({
          edges: [{ targetId, type: 't', confidence: 0.5 }],
        });
      });
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      for (const c of out) expect(c.sourceId).not.toBe(c.targetId);
    });
  });

  describe('malformed responses', () => {
    it('drops malformed JSON for a single node without affecting others', async () => {
      const { store, inspector } = genericFixture();
      const provider = mockLLMProvider((p): string => {
        if (p.includes('id="alpha"')) return 'not json at all';
        return JSON.stringify({
          edges: [{ targetId: 'bravo', type: 't', confidence: 0.5 }],
        });
      });
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      // alpha's row is dropped — no candidates with sourceId='alpha'.
      const alphaCount = out.filter((c) => c.sourceId === 'alpha').length;
      expect(alphaCount).toBe(0);
      // Other sources still produced output.
      expect(out.length).toBeGreaterThan(0);
    });

    it('handles a top-level array response shape', async () => {
      const { store, inspector } = genericFixture();
      const provider = mockLLMProvider(() =>
        JSON.stringify([
          { targetId: 'bravo', type: 't', confidence: 0.5 },
        ]),
      );
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      expect(out.length).toBeGreaterThan(0);
    });

    it('strips ```json fencing before parsing', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson =
        '```json\n' +
        JSON.stringify({
          edges: [{ targetId: 'bravo', type: 't', confidence: 0.5 }],
        }) +
        '\n```';
      const provider = mockLLMProvider(() => cannedJson);
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      expect(out.length).toBeGreaterThan(0);
    });

    it('drops candidates with non-string targetId', async () => {
      const { store, inspector } = genericFixture();
      const cannedJson = JSON.stringify({
        edges: [
          { targetId: 12345, type: 't', confidence: 0.5 },
          { targetId: '', type: 't', confidence: 0.5 },
          { targetId: 'bravo', type: 't', confidence: 0.5 },
        ],
      });
      const provider = mockLLMProvider(() => cannedJson);
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      for (const c of out) {
        expect(typeof c.targetId).toBe('string');
        expect(c.targetId.length).toBeGreaterThan(0);
      }
    });
  });

  describe('cancellation + degraded paths', () => {
    it('returns [] when signal is pre-aborted', async () => {
      const { store, inspector } = genericFixture();
      const provider = mockLLMProvider(() => JSON.stringify({ edges: [] }));
      const ac = new AbortController();
      ac.abort();
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
        signal: ac.signal,
      });
      expect(out).toEqual([]);
      expect(provider.getCallCount()).toBe(0);
    });

    it('returns [] on a single-node graph', async () => {
      const store = new GraphStore();
      store.addNode('only', attrs());
      const inspector = new SchemaInspector(store);
      const provider = mockLLMProvider(() => JSON.stringify({ edges: [] }));
      const out = await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
      });
      expect(out).toEqual([]);
      expect(provider.getCallCount()).toBe(0);
    });
  });

  describe('cache integration', () => {
    it('reuses cached provider responses', async () => {
      const { store, inspector } = genericFixture();
      const provider = mockLLMProvider(() =>
        JSON.stringify({ edges: [{ targetId: 'bravo', type: 't', confidence: 0.5 }] }),
      );
      const cache = lruCache();
      // First pass: 4 calls.
      await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
        cache,
      });
      const after1 = provider.getCallCount();
      expect(after1).toBe(4);
      // Second pass over the same graph + same provider: cached.
      await computeLLMInferences({
        store,
        provider,
        inspector,
        schemaSampleSize: 5,
        cache,
      });
      expect(provider.getCallCount()).toBe(after1);
    });
  });
});

describe('buildLLMInferencePrompt — domain blindness', () => {
  it('renders no Bible-specific vocabulary when fed a generic fixture', () => {
    const { store, inspector } = genericFixture();
    const node = store.getNode('alpha')!;
    const candidates = [
      { id: 'bravo', title: 'Bravo' },
      { id: 'charlie', title: 'Charlie' },
    ];
    const prompt = buildLLMInferencePrompt(
      { id: node.id, attributes: node.attributes },
      candidates,
      inspector.summary(),
      5,
      5,
    );
    // Hard guard: zero domain leakage.
    const forbidden = [
      'adam',
      'eve',
      'noah',
      'cain',
      'abel',
      'seth',
      'father_of',
      'son_of',
      'era',
      'tribe',
      'patriarch',
      'bible',
      'genesis',
      'old testament',
      'new testament',
    ];
    const lower = prompt.toLowerCase();
    for (const word of forbidden) {
      expect(lower).not.toContain(word);
    }
  });

  it('surfaces only schema-derived attribute keys in the schema block', () => {
    const { store, inspector } = genericFixture();
    const node = store.getNode('alpha')!;
    const prompt = buildLLMInferencePrompt(
      { id: node.id, attributes: node.attributes },
      [{ id: 'bravo', title: 'Bravo' }],
      inspector.summary(),
      5,
      5,
    );
    // The schema block lists keys present in the fixture and only those.
    expect(prompt).toContain('color');
    expect(prompt).toContain('kind');
    // It should not invent attributes that don't exist in the fixture.
    expect(prompt).not.toContain('faction');
  });

  it('lists the candidate target ids verbatim', () => {
    const { store, inspector } = genericFixture();
    const node = store.getNode('alpha')!;
    const prompt = buildLLMInferencePrompt(
      { id: node.id, attributes: node.attributes },
      [{ id: 'bravo', title: 'Bravo' }, { id: 'charlie', title: 'Charlie' }],
      inspector.summary(),
      5,
      5,
    );
    expect(prompt).toContain('id="bravo"');
    expect(prompt).toContain('id="charlie"');
  });

  it('limitPerNode value appears in the task instructions', () => {
    const { store, inspector } = genericFixture();
    const node = store.getNode('alpha')!;
    const prompt = buildLLMInferencePrompt(
      { id: node.id, attributes: node.attributes },
      [{ id: 'bravo', title: 'Bravo' }],
      inspector.summary(),
      5,
      3,
    );
    expect(prompt).toContain('up to 3 relationships');
  });
});

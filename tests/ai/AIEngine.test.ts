import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../src/cache/lruCache.js';
import type { NodeData } from '../../src/types.js';

function makeStore(): { store: GraphStore; queryEngine: QueryEngine } {
  const store = new GraphStore();
  const queryEngine = new QueryEngine(store);
  store.addNode('1', { name: 'Adam', type: 'person', era: 'Creation' });
  store.addNode('2', { name: 'Eve', type: 'person', era: 'Creation' });
  store.addNode('3', { name: 'Eden', type: 'place', era: 'Creation' });
  store.addNode('4', { name: 'Abraham', type: 'person', era: 'Patriarchs' });
  return { store, queryEngine };
}

function nodeFromStore(store: GraphStore, id: string): NodeData {
  const node = store.getNode(id);
  if (!node) throw new Error(`missing node ${id}`);
  return { id: node.id, attributes: { ...node.attributes } };
}

describe('AIEngine', () => {
  let store: GraphStore;
  let queryEngine: QueryEngine;
  let engine: AIEngine;

  beforeEach(() => {
    ({ store, queryEngine } = makeStore());
    engine = new AIEngine(store, queryEngine);
  });

  describe('provider lifecycle', () => {
    it('starts with no provider', () => {
      expect(engine.getProvider()).toBeUndefined();
    });

    it('round-trips setProvider / getProvider', () => {
      const p = mockLLMProvider({});
      engine.setProvider(p);
      expect(engine.getProvider()).toBe(p);
    });

    it('starts with no cache', () => {
      expect(engine.getCache()).toBeUndefined();
    });

    it('round-trips setCache / getCache', () => {
      const c = lruCache();
      engine.setCache(c);
      expect(engine.getCache()).toBe(c);
    });
  });

  describe('compileFilter (no provider)', () => {
    it('returns a permissive predicate when no provider is configured', async () => {
      const predicate = await engine.compileFilter('only people');
      expect(predicate(nodeFromStore(store, '1'))).toBe(true);
      expect(predicate(nodeFromStore(store, '3'))).toBe(true);
    });

    it('returns a permissive predicate for an empty query', async () => {
      engine.setProvider(mockLLMProvider({}));
      const predicate = await engine.compileFilter('   ');
      expect(predicate(nodeFromStore(store, '1'))).toBe(true);
    });
  });

  describe('compileFilter (with provider)', () => {
    it('returns a predicate that filters by attribute value', async () => {
      const provider = mockLLMProvider(() =>
        JSON.stringify({ type: ['person'] }),
      );
      engine.setProvider(provider);

      const predicate = await engine.compileFilter('only people');
      expect(predicate(nodeFromStore(store, '1'))).toBe(true); // person
      expect(predicate(nodeFromStore(store, '4'))).toBe(true); // person
      expect(predicate(nodeFromStore(store, '3'))).toBe(false); // place
    });

    it('combines multiple attribute filters as AND', async () => {
      const provider = mockLLMProvider(() =>
        JSON.stringify({ type: ['person'], era: ['Patriarchs'] }),
      );
      engine.setProvider(provider);

      const predicate = await engine.compileFilter('patriarch people only');
      expect(predicate(nodeFromStore(store, '4'))).toBe(true);
      expect(predicate(nodeFromStore(store, '1'))).toBe(false); // creation era
      expect(predicate(nodeFromStore(store, '3'))).toBe(false); // place
    });

    it('treats {} as match-everything', async () => {
      const provider = mockLLMProvider(() => '{}');
      engine.setProvider(provider);
      const predicate = await engine.compileFilter('anything');
      for (const id of ['1', '2', '3', '4']) {
        expect(predicate(nodeFromStore(store, id))).toBe(true);
      }
    });

    it('strips Markdown code fences from the LLM response', async () => {
      const provider = mockLLMProvider(
        () => '```json\n{"type":["place"]}\n```',
      );
      engine.setProvider(provider);
      const predicate = await engine.compileFilter('places');
      expect(predicate(nodeFromStore(store, '3'))).toBe(true);
      expect(predicate(nodeFromStore(store, '1'))).toBe(false);
    });

    it('returns a permissive predicate on malformed JSON', async () => {
      const provider = mockLLMProvider(() => 'not actually json {{{');
      engine.setProvider(provider);
      const predicate = await engine.compileFilter('anything');
      expect(predicate(nodeFromStore(store, '1'))).toBe(true);
      expect(predicate(nodeFromStore(store, '3'))).toBe(true);
    });

    it('returns a permissive predicate when LLM call throws', async () => {
      const provider = mockLLMProvider(() => {
        throw new Error('boom');
      });
      engine.setProvider(provider);
      const predicate = await engine.compileFilter('anything');
      expect(predicate(nodeFromStore(store, '1'))).toBe(true);
    });

    it('passes a JSON format hint to the provider', async () => {
      let observedOpts: unknown;
      const provider = mockLLMProvider((_p, opts) => {
        observedOpts = opts;
        return JSON.stringify({});
      });
      engine.setProvider(provider);
      await engine.compileFilter('anything');
      expect((observedOpts as { format?: string }).format).toBe('json');
    });

    it('embeds a small schema sample in the prompt so the LLM sees attribute keys', async () => {
      const provider = mockLLMProvider({});
      engine.setProvider(provider);
      await engine.compileFilter('anything');
      const prompt = provider.getLastPrompt() ?? '';
      expect(prompt).toContain('type');
      expect(prompt).toContain('era');
      expect(prompt).toContain('person');
      expect(prompt).toContain('place');
      expect(prompt).toContain('Patriarchs');
    });
  });

  describe('caching', () => {
    it('caches identical prompts so the provider is only invoked once', async () => {
      const provider = mockLLMProvider(() => JSON.stringify({ type: ['person'] }));
      engine.setProvider(provider);
      engine.setCache(lruCache({ maxEntries: 10 }));

      await engine.compileFilter('only people');
      await engine.compileFilter('only people');

      expect(provider.getCallCount()).toBe(1);
    });

    it('does not cache when no cache is configured', async () => {
      const provider = mockLLMProvider(() => JSON.stringify({ type: ['person'] }));
      engine.setProvider(provider);

      await engine.compileFilter('only people');
      await engine.compileFilter('only people');

      expect(provider.getCallCount()).toBe(2);
    });

    it('clears cache when the provider instance changes', async () => {
      const a = mockLLMProvider(() => JSON.stringify({ type: ['person'] }));
      const b = mockLLMProvider(() => JSON.stringify({ type: ['place'] }));
      const cache = lruCache({ maxEntries: 10 });
      engine.setCache(cache);

      engine.setProvider(a);
      await engine.compileFilter('q');
      expect(a.getCallCount()).toBe(1);

      // Switch provider — next call must NOT return the cached value from `a`.
      engine.setProvider(b);
      await engine.compileFilter('q');
      expect(b.getCallCount()).toBe(1);

      // And a second call against `b` should now hit the cache.
      await engine.compileFilter('q');
      expect(b.getCallCount()).toBe(1);
    });

    it('different prompts produce different cache keys', async () => {
      const provider = mockLLMProvider(() => JSON.stringify({}));
      engine.setProvider(provider);
      engine.setCache(lruCache({ maxEntries: 10 }));

      await engine.compileFilter('q1');
      await engine.compileFilter('q2');
      await engine.compileFilter('q1');

      expect(provider.getCallCount()).toBe(2);
    });
  });
});

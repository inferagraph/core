import { describe, it, expect, vi } from 'vitest';
import { RemoteInferredEdgeStore } from '../../src/ai/RemoteInferredEdgeStore.js';
import type { InferredEdge } from '../../src/ai/InferredEdge.js';

function makeEdge(sourceId: string, targetId: string, type = 'related_to'): InferredEdge {
  return { sourceId, targetId, type, score: 0.5, sources: ['graph'] };
}

describe('RemoteInferredEdgeStore', () => {
  describe('construction', () => {
    it('accepts a URL string', () => {
      expect(() => new RemoteInferredEdgeStore('/api/inferred-edges')).not.toThrow();
    });

    it('accepts an options object with explicit fetcher', () => {
      const fetcher = vi.fn().mockResolvedValue([]);
      expect(
        () => new RemoteInferredEdgeStore({ fetcher }),
      ).not.toThrow();
    });

    it('accepts an options object with url + cacheTtlMs', () => {
      expect(
        () => new RemoteInferredEdgeStore({ url: '/x', cacheTtlMs: 60_000 }),
      ).not.toThrow();
    });

    it('prefers an explicit fetcher over the url-derived default when both are passed', async () => {
      const fetcher = vi.fn().mockResolvedValue([makeEdge('a', 'b')]);
      const globalFetch = vi.fn(); // would explode if reached
      vi.stubGlobal('fetch', globalFetch);
      const store = new RemoteInferredEdgeStore({ url: '/api/x', fetcher });
      await store.getAll();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(globalFetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe('getAll', () => {
    it('returns the fetched edges', async () => {
      const edges = [makeEdge('a', 'b'), makeEdge('c', 'd')];
      const fetcher = vi.fn().mockResolvedValue(edges);
      const store = new RemoteInferredEdgeStore({ fetcher });
      await expect(store.getAll()).resolves.toEqual(edges);
    });

    it('caches the result so subsequent getAll() calls do not re-fetch', async () => {
      const edges = [makeEdge('a', 'b')];
      const fetcher = vi.fn().mockResolvedValue(edges);
      const store = new RemoteInferredEdgeStore({ fetcher });
      await store.getAll();
      await store.getAll();
      await store.getAll();
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('uses fetch(url) by default when only url is provided', async () => {
      const edges = [makeEdge('a', 'b')];
      const globalFetch = vi.fn().mockResolvedValue({
        json: async () => edges,
      });
      vi.stubGlobal('fetch', globalFetch);
      const store = new RemoteInferredEdgeStore({ url: '/api/inferred-edges' });
      await expect(store.getAll()).resolves.toEqual(edges);
      expect(globalFetch).toHaveBeenCalledWith(
        '/api/inferred-edges',
        expect.objectContaining({ signal: expect.anything() }),
      );
      vi.unstubAllGlobals();
    });

    it('treats a string constructor argument as the url', async () => {
      const edges = [makeEdge('a', 'b')];
      const globalFetch = vi.fn().mockResolvedValue({
        json: async () => edges,
      });
      vi.stubGlobal('fetch', globalFetch);
      const store = new RemoteInferredEdgeStore('/api/y');
      await expect(store.getAll()).resolves.toEqual(edges);
      expect(globalFetch).toHaveBeenCalledWith(
        '/api/y',
        expect.objectContaining({ signal: expect.anything() }),
      );
      vi.unstubAllGlobals();
    });
  });

  describe('refresh', () => {
    it('forces a re-fetch the next time getAll runs', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce([makeEdge('a', 'b')])
        .mockResolvedValueOnce([makeEdge('a', 'b'), makeEdge('c', 'd')]);
      const store = new RemoteInferredEdgeStore({ fetcher });
      const first = await store.getAll();
      expect(first).toHaveLength(1);
      await store.refresh();
      const second = await store.getAll();
      expect(second).toHaveLength(2);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('cacheTtlMs', () => {
    it('re-fetches when the cached value is stale', async () => {
      vi.useFakeTimers();
      try {
        const fetcher = vi
          .fn()
          .mockResolvedValueOnce([makeEdge('a', 'b')])
          .mockResolvedValueOnce([makeEdge('c', 'd')]);
        const store = new RemoteInferredEdgeStore({ fetcher, cacheTtlMs: 1000 });
        await store.getAll();
        vi.advanceTimersByTime(1500);
        const second = await store.getAll();
        expect(second).toEqual([makeEdge('c', 'd')]);
        expect(fetcher).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('get', () => {
    it('returns the matching edge by (sourceId, targetId)', async () => {
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
      const fetcher = vi.fn().mockResolvedValue(edges);
      const store = new RemoteInferredEdgeStore({ fetcher });
      const hit = await store.get('a', 'b');
      expect(hit?.sourceId).toBe('a');
      expect(hit?.targetId).toBe('b');
    });

    it('returns undefined when nothing matches', async () => {
      const fetcher = vi.fn().mockResolvedValue([makeEdge('a', 'b')]);
      const store = new RemoteInferredEdgeStore({ fetcher });
      await expect(store.get('x', 'y')).resolves.toBeUndefined();
    });

    it('respects edge directionality', async () => {
      const fetcher = vi.fn().mockResolvedValue([makeEdge('a', 'b')]);
      const store = new RemoteInferredEdgeStore({ fetcher });
      const reverse = await store.get('b', 'a');
      expect(reverse).toBeUndefined();
    });
  });

  describe('getAllForNode', () => {
    it('returns every edge incident to the node in either direction', async () => {
      const edges = [
        makeEdge('a', 'b'),
        makeEdge('c', 'a'),
        makeEdge('d', 'e'),
      ];
      const fetcher = vi.fn().mockResolvedValue(edges);
      const store = new RemoteInferredEdgeStore({ fetcher });
      const hits = await store.getAllForNode('a');
      expect(hits).toHaveLength(2);
      const pairs = hits.map((e) => `${e.sourceId}->${e.targetId}`);
      expect(pairs).toContain('a->b');
      expect(pairs).toContain('c->a');
    });
  });

  describe('read-only enforcement', () => {
    it('throws on set()', async () => {
      const store = new RemoteInferredEdgeStore({ fetcher: vi.fn().mockResolvedValue([]) });
      await expect(store.set([])).rejects.toThrow(/read-only/i);
    });

    it('throws on clear()', async () => {
      const store = new RemoteInferredEdgeStore({ fetcher: vi.fn().mockResolvedValue([]) });
      await expect(store.clear()).rejects.toThrow(/read-only/i);
    });
  });

  describe('AbortSignal', () => {
    it('forwards a signal to the default fetcher', async () => {
      const globalFetch = vi.fn().mockResolvedValue({ json: async () => [] });
      vi.stubGlobal('fetch', globalFetch);
      const store = new RemoteInferredEdgeStore({ url: '/api/z' });
      await store.getAll();
      const callArgs = globalFetch.mock.calls[0]?.[1];
      expect(callArgs).toBeDefined();
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
      vi.unstubAllGlobals();
    });
  });
});

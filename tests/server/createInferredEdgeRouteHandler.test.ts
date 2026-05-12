import { describe, it, expect, vi } from 'vitest';
import { createInferredEdgeRouteHandler } from '../../src/server/createInferredEdgeRouteHandler.js';
import type { InferredEdge } from '../../src/ai/InferredEdge.js';
import type { AIEngine } from '../../src/ai/AIEngine.js';

function edge(sourceId: string, targetId: string): InferredEdge {
  return { sourceId, targetId, type: 'related_to', score: 0.5, sources: ['graph'] };
}

function makeFakeEngine(opts: {
  initial: InferredEdge[];
  afterCompute?: InferredEdge[];
  computeDelayMs?: number;
}): {
  engine: AIEngine;
  computeSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
} {
  let current = [...opts.initial];
  const computeSpy = vi.fn().mockImplementation(async () => {
    if (opts.computeDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, opts.computeDelayMs));
    }
    if (opts.afterCompute) current = [...opts.afterCompute];
  });
  const getSpy = vi.fn().mockImplementation(async () => current);
  const engine = {
    computeInferredEdges: computeSpy,
    getInferredEdges: getSpy,
  } as unknown as AIEngine;
  return { engine, computeSpy, getSpy };
}

describe('createInferredEdgeRouteHandler', () => {
  it('returns the cached edges as JSON when the store is non-empty (no compute)', async () => {
    const { engine, computeSpy } = makeFakeEngine({
      initial: [edge('a', 'b'), edge('c', 'd')],
    });
    const handler = createInferredEdgeRouteHandler(engine);
    const res = await handler(new Request('http://localhost/api/inferred-edges'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(computeSpy).not.toHaveBeenCalled();
  });

  it('emits a cache-control header for HTTP caching', async () => {
    const { engine } = makeFakeEngine({ initial: [edge('a', 'b')] });
    const handler = createInferredEdgeRouteHandler(engine);
    const res = await handler(new Request('http://localhost/x'));
    expect(res.headers.get('cache-control')).toContain('max-age');
  });

  it('lazily computes when the store is empty (lazyCompute default true)', async () => {
    const { engine, computeSpy } = makeFakeEngine({
      initial: [],
      afterCompute: [edge('a', 'b')],
    });
    const handler = createInferredEdgeRouteHandler(engine);
    const res = await handler(new Request('http://localhost/x'));
    expect(computeSpy).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it('skips the lazy compute when lazyCompute is false', async () => {
    const { engine, computeSpy } = makeFakeEngine({
      initial: [],
      afterCompute: [edge('a', 'b')],
    });
    const handler = createInferredEdgeRouteHandler(engine, { lazyCompute: false });
    const res = await handler(new Request('http://localhost/x'));
    expect(computeSpy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('shares an in-flight compute across concurrent requests', async () => {
    const { engine, computeSpy } = makeFakeEngine({
      initial: [],
      afterCompute: [edge('a', 'b')],
      computeDelayMs: 30,
    });
    const handler = createInferredEdgeRouteHandler(engine);
    const [r1, r2, r3] = await Promise.all([
      handler(new Request('http://localhost/x')),
      handler(new Request('http://localhost/x')),
      handler(new Request('http://localhost/x')),
    ]);
    // All three callers see the computed result.
    for (const r of [r1, r2, r3]) {
      const body = await r.json();
      expect(body).toHaveLength(1);
    }
    // computeInferredEdges fired exactly once across all three.
    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('re-runs compute on a subsequent request after the prior one resolved (no permanent latch)', async () => {
    let current: InferredEdge[] = [];
    const computeSpy = vi.fn().mockImplementation(async () => {
      // First compute populates, second leaves it alone.
      if (current.length === 0) current = [edge('a', 'b')];
    });
    const getSpy = vi.fn().mockImplementation(async () => current);
    const engine = {
      computeInferredEdges: computeSpy,
      getInferredEdges: getSpy,
    } as unknown as AIEngine;
    const handler = createInferredEdgeRouteHandler(engine);

    await handler(new Request('http://localhost/x'));
    // After the first call, the store is populated; subsequent calls skip compute.
    await handler(new Request('http://localhost/x'));
    expect(computeSpy).toHaveBeenCalledTimes(1);

    // Force re-empty externally; the next call should re-trigger compute.
    current = [];
    await handler(new Request('http://localhost/x'));
    expect(computeSpy).toHaveBeenCalledTimes(2);
  });
});

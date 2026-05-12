import type { AIEngine } from '../ai/AIEngine.js';

/**
 * Options for {@link createInferredEdgeRouteHandler}.
 */
export interface CreateInferredEdgeRouteHandlerOptions {
  /**
   * When `true` (the default), the handler triggers
   * `engine.computeInferredEdges()` on the first request that finds the
   * store empty so a fresh deployment can populate the overlay without
   * an explicit warmup step. Concurrent first-requests share a single
   * in-flight compute.
   *
   * Set `false` to disable lazy compute entirely — the handler then
   * returns whatever the store currently has (often `[]` until a
   * scheduled or manual warmup runs).
   */
  lazyCompute?: boolean;
}

/**
 * Build a Web-Standard (Request → Promise<Response>) handler that
 * surfaces the persisted inferred-edge overlay as JSON. Pair with
 * {@link RemoteInferredEdgeStore} in the browser to wire the overlay
 * end-to-end without exposing the AIEngine to the client.
 *
 * Wire-up examples:
 *
 *   ```ts
 *   // Next.js App Router (app/api/inferred-edges/route.ts):
 *   import { createInferredEdgeRouteHandler } from '@inferagraph/core/server';
 *   import { getServerEngine } from '@/lib/engine';
 *   export const GET = createInferredEdgeRouteHandler(await getServerEngine());
 *
 *   // Express adapter (Node 20+ with fetch / Request / Response):
 *   const handler = createInferredEdgeRouteHandler(engine);
 *   app.get('/api/inferred-edges', async (req, res) => {
 *     const r = await handler(new Request(`http://x${req.originalUrl}`));
 *     res.status(r.status);
 *     r.headers.forEach((v, k) => res.setHeader(k, v));
 *     res.send(await r.text());
 *   });
 *   ```
 */
export function createInferredEdgeRouteHandler(
  engine: AIEngine,
  options: CreateInferredEdgeRouteHandlerOptions = {},
): (req: Request) => Promise<Response> {
  const lazyCompute = options.lazyCompute !== false;
  let inflight: Promise<void> | undefined;

  return async function inferredEdgeRouteHandler(
    _req: Request,
  ): Promise<Response> {
    let edges = await engine.getInferredEdges();
    if (edges.length === 0 && lazyCompute) {
      // Concurrent-compute idempotency: requests that arrive while a
      // compute is in flight wait on the SAME promise instead of
      // kicking off duplicate runs. The `finally` clears the slot so
      // a later empty-store request can re-trigger compute (the empty
      // state may be re-entered after a clear, an eviction, etc.).
      if (!inflight) {
        inflight = engine
          .computeInferredEdges()
          .finally(() => {
            inflight = undefined;
          });
      }
      await inflight;
      edges = await engine.getInferredEdges();
    }
    return new Response(JSON.stringify(edges), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300',
      },
    });
  };
}

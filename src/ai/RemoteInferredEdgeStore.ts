import type { InferredEdge, InferredEdgeStore } from './InferredEdge.js';
import type { NodeId } from '../types.js';

/**
 * Constructor options for {@link RemoteInferredEdgeStore}.
 */
export interface RemoteInferredEdgeStoreOptions {
  /**
   * Custom fetcher. Called once per cache miss; receives an
   * `AbortSignal` so consumers can wire teardown / cancellation.
   * Wins over {@link url} when both are supplied.
   */
  fetcher?: (signal?: AbortSignal) => Promise<InferredEdge[]>;
  /**
   * URL fetched by the built-in default fetcher when {@link fetcher}
   * is not provided. The default issues `fetch(url, { signal }).then(r => r.json())`.
   */
  url?: string;
  /**
   * In-memory cache lifetime in ms. `undefined` (the default) means the
   * cache never expires for the lifetime of the store; call
   * {@link RemoteInferredEdgeStore.refresh} to force a re-fetch.
   */
  cacheTtlMs?: number;
}

/**
 * Read-only {@link InferredEdgeStore} backed by an HTTP endpoint. Hosts
 * pair this with `createInferredEdgeRouteHandler` (server-side) to
 * expose the persisted inferred-edge overlay to a browser bundle
 * without giving the client direct access to the AIEngine.
 *
 * Caching:
 *   - The first `getAll()` call triggers the fetch. Subsequent calls
 *     return the in-memory snapshot until {@link refresh} is invoked or
 *     the TTL elapses.
 *   - `get()` and `getAllForNode()` are thin filters over the cached
 *     snapshot — they never fetch on their own.
 *
 * Mutation: `set()` and `clear()` always throw. Inferred-edge
 * persistence is owned server-side; the client just reads.
 */
export class RemoteInferredEdgeStore implements InferredEdgeStore {
  private readonly fetcher: (signal?: AbortSignal) => Promise<InferredEdge[]>;
  private readonly cacheTtlMs: number | undefined;
  private cached: ReadonlyArray<InferredEdge> | undefined;
  private cachedAt: number | undefined;
  private inflight: Promise<ReadonlyArray<InferredEdge>> | undefined;

  constructor(input: string | RemoteInferredEdgeStoreOptions) {
    const opts: RemoteInferredEdgeStoreOptions =
      typeof input === 'string' ? { url: input } : input;
    if (opts.fetcher) {
      this.fetcher = opts.fetcher;
    } else if (opts.url) {
      const url = opts.url;
      this.fetcher = async (signal?: AbortSignal) => {
        const res = await fetch(url, { signal });
        return (await res.json()) as InferredEdge[];
      };
    } else {
      throw new Error(
        'RemoteInferredEdgeStore requires either `fetcher` or `url` (or a string URL).',
      );
    }
    this.cacheTtlMs = opts.cacheTtlMs;
  }

  async get(sourceId: NodeId, targetId: NodeId): Promise<InferredEdge | undefined> {
    const all = await this.getAll();
    return all.find((e) => e.sourceId === sourceId && e.targetId === targetId);
  }

  async getAllForNode(nodeId: NodeId): Promise<InferredEdge[]> {
    const all = await this.getAll();
    return all.filter((e) => e.sourceId === nodeId || e.targetId === nodeId);
  }

  async getAll(): Promise<InferredEdge[]> {
    if (this.cached && !this.isStale()) return this.cached.slice();
    if (this.inflight) return (await this.inflight).slice();
    const controller = new AbortController();
    const promise = this.fetcher(controller.signal).then((edges) => {
      this.cached = edges;
      this.cachedAt = Date.now();
      this.inflight = undefined;
      return this.cached;
    });
    this.inflight = promise.catch((err) => {
      this.inflight = undefined;
      throw err;
    });
    const result = await promise;
    return result.slice();
  }

  async set(_edges: ReadonlyArray<InferredEdge>): Promise<void> {
    throw new Error('RemoteInferredEdgeStore is read-only; set() not supported');
  }

  async clear(): Promise<void> {
    throw new Error('RemoteInferredEdgeStore is read-only; clear() not supported');
  }

  /**
   * Drop the in-memory cache so the next {@link getAll} re-fetches.
   * Use after a known server-side reindex when the persistent store
   * has new edges that the client should pick up.
   */
  refresh(): void {
    this.cached = undefined;
    this.cachedAt = undefined;
    this.inflight = undefined;
  }

  private isStale(): boolean {
    if (this.cacheTtlMs === undefined) return false;
    if (this.cachedAt === undefined) return true;
    return Date.now() - this.cachedAt > this.cacheTtlMs;
  }
}

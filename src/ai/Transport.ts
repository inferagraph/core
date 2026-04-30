import type { ChatEvent, ChatOptions } from './ChatEvent.js';
import type { LLMProvider } from './LLMProvider.js';
import type { CacheProvider } from '../cache/lruCache.js';
import { GraphStore } from '../store/GraphStore.js';
import { QueryEngine } from '../store/QueryEngine.js';
import { AIEngine, buildPredicateFromSpec, type AIEngineConfig } from './AIEngine.js';

/**
 * Abstract chat transport. The same shape on either side: pass a message
 * (and optional cancel signal / emit-tool-calls flag), get an async iterable
 * of {@link ChatEvent}s back.
 *
 * Two built-in implementations:
 *   - {@link inProcessTransport} — runs the AIEngine in the current JS
 *     context. Suitable for tests, demos, and any host where the API key
 *     can live in the same process as the renderer.
 *   - {@link httpTransport} — POSTs the message to a server endpoint and
 *     parses an SSE response into ChatEvents. Used by Next.js / browser
 *     hosts that must keep the LLM + cache server-side (because the redis
 *     client can't run in the browser, and API keys must not be exposed
 *     to it).
 *
 * Hosts may also implement a custom transport if they need bespoke routing
 * (queueing, fanout, retry, etc.). The contract is intentionally tiny.
 */
export interface Transport {
  chat(message: string, opts?: ChatOptions): AsyncIterable<ChatEvent>;
}

/**
 * Configuration for {@link inProcessTransport}. Either pass an existing
 * {@link AIEngine} (advanced — when you've already constructed one) or
 * the provider/cache/config triple (typical — the transport builds the
 * engine for you).
 */
export interface InProcessTransportConfig {
  /** LLM provider. Required when no `engine` is supplied. */
  provider?: LLMProvider;
  /** Optional response cache. */
  cache?: CacheProvider;
  /** Optional AIEngine config (e.g. `schemaSampleSize`). */
  aiConfig?: AIEngineConfig;
  /** Optional pre-built {@link AIEngine}. Wins over the other fields. */
  engine?: AIEngine;
  /** Optional pre-built {@link GraphStore} (used when building a fresh engine). */
  store?: GraphStore;
}

/**
 * In-process transport. Constructs (or reuses) an {@link AIEngine} and
 * forwards `chat` calls directly to it. The transport does NOT own the
 * graph data — when no `engine` is supplied, the caller is responsible
 * for loading nodes into the supplied store before invoking `chat`.
 *
 * In typical app usage the React layer reuses the AIEngine that
 * `GraphProvider` already constructed; the transport function is exposed
 * for non-React consumers and tests.
 */
export function inProcessTransport(
  config: InProcessTransportConfig,
): Transport {
  let engine = config.engine;
  if (!engine) {
    const store = config.store ?? new GraphStore();
    const queryEngine = new QueryEngine(store);
    engine = new AIEngine(store, queryEngine, config.aiConfig);
    if (config.provider) engine.setProvider(config.provider);
    if (config.cache) engine.setCache(config.cache);
  }
  const e = engine;
  return {
    chat(message: string, opts?: ChatOptions): AsyncIterable<ChatEvent> {
      return e.chat(message, opts);
    },
  };
}

/**
 * Configuration for {@link httpTransport}.
 */
export interface HttpTransportConfig {
  /** Endpoint URL. e.g. `'/api/chat'`. */
  url: string;
  /** Override `fetch` (testing / non-DOM environments). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Extra headers. The transport always sets `Content-Type: application/json`. */
  headers?: HeadersInit;
}

/**
 * HTTP transport. POSTs `{ message, emitToolCalls }` to the configured
 * endpoint and parses the response as Server-Sent Events into
 * {@link ChatEvent}s.
 *
 * SSE format (mirrors what biblegraph's `/api/chat` route emits in Phase
 * 2C):
 *   ```
 *   data: {"type":"text","delta":"hello"}
 *
 *   data: {"type":"done","reason":"stop"}
 *   ```
 * Each `data:` line is a JSON-encoded {@link ChatEvent}. Blank lines
 * delimit events. The transport silently drops malformed lines so a
 * single bad line doesn't break the rest of the stream.
 *
 * Tool-call events that carry a function predicate (`apply_filter`) are
 * round-tripped via the `spec` field — the transport rebuilds the
 * predicate on the client side using the same `buildPredicateFromSpec`
 * helper as the live path. This keeps the wire format JSON-clean.
 */
export function httpTransport(config: HttpTransportConfig): Transport {
  const fetchFn = config.fetch ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      'httpTransport: no fetch implementation available. Pass `fetch` in config.',
    );
  }
  return {
    async *chat(
      message: string,
      opts?: ChatOptions,
    ): AsyncGenerator<ChatEvent, void, unknown> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (config.headers) {
        const inHeaders = new Headers(config.headers);
        inHeaders.forEach((v, k) => {
          headers[k] = v;
        });
      }
      let response: Response;
      try {
        response = await fetchFn(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message,
            emitToolCalls: !!opts?.emitToolCalls,
          }),
          signal: opts?.signal,
        });
      } catch (err) {
        const isAbort =
          opts?.signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError');
        yield {
          type: 'done',
          reason: isAbort ? 'aborted' : 'stop',
          error: isAbort
            ? undefined
            : err instanceof Error
              ? err.message
              : 'fetch failed',
        };
        return;
      }
      if (!response.ok) {
        yield {
          type: 'done',
          reason: 'stop',
          error: `HTTP ${response.status}`,
        };
        return;
      }
      if (!response.body) {
        yield { type: 'done', reason: 'stop', error: 'empty response body' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawDone = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE events are delimited by blank lines (\n\n). Process every
          // complete event currently in the buffer, leave the partial
          // tail for the next read.
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const parsed = parseSSEEvent(raw);
            if (!parsed) continue;
            for (const ev of parsed) {
              if (ev.type === 'done') sawDone = true;
              yield ev;
            }
          }
          if (opts?.signal?.aborted) {
            // Best-effort: emit our own done; the server's stream may not
            // have flushed yet.
            if (!sawDone) {
              yield { type: 'done', reason: 'aborted' };
              sawDone = true;
            }
            break;
          }
        }
        // Process any final unterminated event.
        if (buffer.length > 0 && !sawDone) {
          const parsed = parseSSEEvent(buffer);
          if (parsed) {
            for (const ev of parsed) {
              if (ev.type === 'done') sawDone = true;
              yield ev;
            }
          }
        }
      } catch (err) {
        const isAbort =
          opts?.signal?.aborted ||
          (err instanceof Error && err.name === 'AbortError');
        yield {
          type: 'done',
          reason: isAbort ? 'aborted' : 'stop',
          error: isAbort
            ? undefined
            : err instanceof Error
              ? err.message
              : 'stream failed',
        };
        return;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // releaseLock can throw if the reader was already errored — ignore.
        }
      }
      if (!sawDone) {
        yield { type: 'done', reason: 'stop' };
      }
    },
  };
}

/**
 * Parse a single SSE event (multiple `data:` lines collapse into one
 * payload per the SSE spec). Returns the decoded {@link ChatEvent}s, or
 * null on a payload that isn't valid JSON or doesn't reconstruct into a
 * supported event shape.
 */
function parseSSEEvent(raw: string): ChatEvent[] | null {
  const lines = raw.split(/\r?\n/);
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataParts.length === 0) return null;
  const payload = dataParts.join('\n');
  try {
    const parsed = JSON.parse(payload) as unknown;
    const reconstructed = reconstructChatEvent(parsed);
    return reconstructed ? [reconstructed] : null;
  } catch {
    return null;
  }
}

/**
 * Rebuild a wire-format ChatEvent from a JSON-decoded payload. The HTTP
 * wire shape mirrors {@link ChatEvent} except `apply_filter` carries
 * only the spec (predicates aren't serialisable) — the predicate is
 * re-derived on this end.
 */
function reconstructChatEvent(parsed: unknown): ChatEvent | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  switch (p.type) {
    case 'text': {
      if (typeof p.delta !== 'string') return null;
      return { type: 'text', delta: p.delta };
    }
    case 'apply_filter': {
      const spec = p.spec;
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
      const safe: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(spec as Record<string, unknown>)) {
        if (!Array.isArray(v)) continue;
        const arr: string[] = [];
        for (const item of v) {
          if (typeof item === 'string') arr.push(item);
        }
        if (arr.length > 0) safe[k] = arr;
      }
      return {
        type: 'apply_filter',
        spec: safe,
        predicate: buildPredicateFromSpec(safe),
      };
    }
    case 'highlight': {
      const ids = p.ids;
      if (!Array.isArray(ids)) return null;
      const out = new Set<string>();
      for (const id of ids) {
        if (typeof id === 'string') out.add(id);
      }
      return { type: 'highlight', ids: out };
    }
    case 'focus': {
      if (typeof p.nodeId !== 'string') return null;
      return { type: 'focus', nodeId: p.nodeId };
    }
    case 'annotate': {
      if (typeof p.nodeId !== 'string' || typeof p.text !== 'string') return null;
      return { type: 'annotate', nodeId: p.nodeId, text: p.text };
    }
    case 'done': {
      const reason = p.reason;
      const error = typeof p.error === 'string' ? p.error : undefined;
      const allowed = ['stop', 'length', 'aborted'] as const;
      const r =
        typeof reason === 'string' && (allowed as readonly string[]).includes(reason)
          ? (reason as 'stop' | 'length' | 'aborted')
          : undefined;
      const event: ChatEvent = { type: 'done' };
      if (r) event.reason = r;
      if (error) event.error = error;
      return event;
    }
    default:
      return null;
  }
}

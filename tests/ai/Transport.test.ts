import { describe, it, expect, vi } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import {
  inProcessTransport,
  httpTransport,
} from '../../src/ai/Transport.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type { LLMStreamEvent } from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('1', { name: 'Adam', type: 'person' });
  return store;
}

describe('inProcessTransport', () => {
  it('delegates to a pre-built AIEngine when one is supplied', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store));
    const provider = mockLLMProvider(() => 'hi');
    engine.setProvider(provider);

    const transport = inProcessTransport({ engine });
    const events = await collect(transport.chat('hello'));
    expect(events.find((e) => e.type === 'text')).toMatchObject({ delta: 'hi' });
  });

  it('builds a fresh AIEngine from provider/store when none is supplied', async () => {
    const provider = mockLLMProvider(() => 'fresh');
    const transport = inProcessTransport({ provider });
    const events = await collect(transport.chat('hello'));
    expect(events.find((e) => e.type === 'text')).toMatchObject({
      delta: 'fresh',
    });
  });

  it('forwards emitToolCalls to AIEngine.chat', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      {
        type: 'tool_call',
        name: 'focus',
        arguments: JSON.stringify({ nodeId: 'x' }),
      },
      { type: 'done', reason: 'stop' },
    ]);
    const transport = inProcessTransport({ provider });
    const withTool = await collect(
      transport.chat('focus', { emitToolCalls: true }),
    );
    expect(withTool.some((e) => e.type === 'focus')).toBe(true);

    const withoutTool = await collect(transport.chat('focus'));
    expect(withoutTool.some((e) => e.type === 'focus')).toBe(false);
  });
});

describe('httpTransport', () => {
  function sseResponse(body: string): Response {
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  function buildSSE(events: ChatEvent[]): string {
    return events
      .map((ev) => {
        // Cannot serialise predicate functions; strip before write.
        const stripped = { ...ev } as Record<string, unknown>;
        if ('predicate' in stripped) delete stripped.predicate;
        if ('ids' in stripped && stripped.ids instanceof Set) {
          stripped.ids = Array.from(stripped.ids as Set<string>);
        }
        return `data: ${JSON.stringify(stripped)}\n\n`;
      })
      .join('');
  }

  it('parses SSE stream into ChatEvents', async () => {
    const fetch = vi.fn(async () =>
      sseResponse(
        buildSSE([
          { type: 'text', delta: 'hello' },
          { type: 'done', reason: 'stop' },
        ]),
      ),
    );
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(transport.chat('hi'));
    expect(events).toEqual([
      { type: 'text', delta: 'hello' },
      { type: 'done', reason: 'stop' },
    ]);
  });

  it('reconstructs apply_filter predicate on the client', async () => {
    const sse = `data: ${JSON.stringify({
      type: 'apply_filter',
      spec: { type: ['person'] },
    })}\n\ndata: ${JSON.stringify({ type: 'done', reason: 'stop' })}\n\n`;
    const fetch = vi.fn(async () => sseResponse(sse));
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(
      transport.chat('hi', { emitToolCalls: true }),
    );
    const filterEvent = events.find((e) => e.type === 'apply_filter');
    expect(filterEvent).toBeDefined();
    if (filterEvent && filterEvent.type === 'apply_filter') {
      expect(filterEvent.spec).toEqual({ type: ['person'] });
      expect(
        filterEvent.predicate({ id: '1', attributes: { type: 'person' } }),
      ).toBe(true);
      expect(
        filterEvent.predicate({ id: '2', attributes: { type: 'place' } }),
      ).toBe(false);
    }
  });

  it('reconstructs highlight ids into a Set', async () => {
    const sse = `data: ${JSON.stringify({
      type: 'highlight',
      ids: ['a', 'b'],
    })}\n\ndata: ${JSON.stringify({ type: 'done', reason: 'stop' })}\n\n`;
    const fetch = vi.fn(async () => sseResponse(sse));
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(
      transport.chat('hi', { emitToolCalls: true }),
    );
    const hi = events.find((e) => e.type === 'highlight');
    expect(hi).toBeDefined();
    if (hi && hi.type === 'highlight') {
      expect(hi.ids.size).toBe(2);
      expect(hi.ids.has('a')).toBe(true);
    }
  });

  it('emits a done event with error on HTTP failure', async () => {
    const fetch = vi.fn(async () =>
      new Response('forbidden', { status: 403 }),
    );
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(transport.chat('hi'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'done', error: 'HTTP 403' });
  });

  it('emits a done event with error when fetch rejects', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(transport.chat('hi'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'done', error: 'network down' });
  });

  it('drops malformed SSE lines without breaking the stream', async () => {
    const sse =
      'data: not-json\n\n' +
      `data: ${JSON.stringify({ type: 'text', delta: 'survived' })}\n\n` +
      `data: ${JSON.stringify({ type: 'done', reason: 'stop' })}\n\n`;
    const fetch = vi.fn(async () => sseResponse(sse));
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(transport.chat('hi'));
    expect(events.find((e) => e.type === 'text')).toMatchObject({
      delta: 'survived',
    });
  });

  it('passes through Content-Type and accepts custom headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetch = vi.fn(async (_url, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return sseResponse(buildSSE([{ type: 'done', reason: 'stop' }]));
    });
    const transport = httpTransport({
      url: '/api/chat',
      fetch,
      headers: { Authorization: 'Bearer xyz' },
    });
    await collect(transport.chat('hi'));
    // Headers are stored case-insensitively when sourced from a Headers
    // instance. The transport always sets Content-Type itself.
    expect(capturedHeaders?.['Content-Type']).toBe('application/json');
    // Custom headers come through; the case may be normalised by Headers.
    const auth =
      capturedHeaders?.['Authorization'] ?? capturedHeaders?.['authorization'];
    expect(auth).toBe('Bearer xyz');
  });

  it('synthesises a done event when the response stream ends without one', async () => {
    const sse = `data: ${JSON.stringify({ type: 'text', delta: 'hi' })}\n\n`;
    const fetch = vi.fn(async () => sseResponse(sse));
    const transport = httpTransport({ url: '/api/chat', fetch });
    const events = await collect(transport.chat('hi'));
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('emits aborted done when the signal aborts before fetch resolves', async () => {
    const fetch = vi.fn(async (_url, init?: RequestInit) => {
      // Honour the signal — real fetches do.
      if (init?.signal?.aborted) {
        const err = new Error('abort');
        err.name = 'AbortError';
        throw err;
      }
      return sseResponse(buildSSE([{ type: 'done', reason: 'stop' }]));
    });
    const transport = httpTransport({ url: '/api/chat', fetch });
    const ac = new AbortController();
    ac.abort();
    const events = await collect(transport.chat('hi', { signal: ac.signal }));
    expect(events).toEqual([{ type: 'done', reason: 'aborted' }]);
  });
});

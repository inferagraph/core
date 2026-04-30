import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../src/cache/lruCache.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type { LLMStreamEvent } from '../../src/ai/LLMProvider.js';

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('1', { name: 'Adam', type: 'person', era: 'Creation' });
  store.addNode('2', { name: 'Eve', type: 'person', era: 'Creation' });
  store.addNode('3', { name: 'Eden', type: 'place', era: 'Creation' });
  store.addNode('4', { name: 'Abraham', type: 'person', era: 'Patriarchs' });
  return store;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('AIEngine.chat()', () => {
  let store: GraphStore;
  let engine: AIEngine;

  beforeEach(() => {
    store = makeStore();
    engine = new AIEngine(store, new QueryEngine(store));
  });

  describe('basic streaming', () => {
    it('yields a single done event when no provider is configured', async () => {
      const events = await collect(engine.chat('hello'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'done', error: 'no provider' });
    });

    it('yields a done event for an empty message', async () => {
      const provider = mockLLMProvider(() => 'should not be called');
      engine.setProvider(provider);
      const events = await collect(engine.chat('   '));
      expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
      expect(provider.getStreamCallCount()).toBe(0);
    });

    it('yields text events from the provider stream', async () => {
      const provider = mockLLMProvider(() => 'hello world');
      engine.setProvider(provider);
      const events = await collect(engine.chat('hi'));
      expect(events).toEqual([
        { type: 'text', delta: 'hello world' },
        { type: 'done', reason: 'stop' },
      ]);
    });

    it('relays multiple text deltas in order', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        { type: 'text', delta: 'one ' },
        { type: 'text', delta: 'two ' },
        { type: 'text', delta: 'three' },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(engine.chat('hi'));
      expect(events).toEqual([
        { type: 'text', delta: 'one ' },
        { type: 'text', delta: 'two ' },
        { type: 'text', delta: 'three' },
        { type: 'done', reason: 'stop' },
      ]);
    });

    it('always yields a final done event even when the stream lacks one', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        { type: 'text', delta: 'hi' },
        // No done event from the LLM mock, but the AIEngine wraps it.
      ]);
      engine.setProvider(provider);
      const events = await collect(engine.chat('hi'));
      // The mock's stream() auto-appends done; AIEngine must NOT double up.
      expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    });
  });

  describe('tool-call translation', () => {
    it('hides tool calls by default', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        { type: 'text', delta: 'sure' },
        {
          type: 'tool_call',
          name: 'apply_filter',
          arguments: JSON.stringify({ spec: { type: ['person'] } }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(engine.chat('show people'));
      expect(events.map((e) => e.type)).toEqual(['text', 'done']);
    });

    it('emits tool calls when emitToolCalls=true', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'apply_filter',
          arguments: JSON.stringify({ spec: { type: ['person'] } }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('show people', { emitToolCalls: true }),
      );
      expect(events.map((e) => e.type)).toEqual(['apply_filter', 'done']);
    });

    it('apply_filter tool call produces a working predicate', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'apply_filter',
          arguments: JSON.stringify({ spec: { type: ['person'] } }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('only people', { emitToolCalls: true }),
      );
      const filterEvent = events.find(
        (e): e is Extract<ChatEvent, { type: 'apply_filter' }> =>
          e.type === 'apply_filter',
      );
      expect(filterEvent).toBeDefined();
      expect(filterEvent!.spec).toEqual({ type: ['person'] });
      // Predicate filters non-person nodes out.
      expect(
        filterEvent!.predicate({ id: '1', attributes: { type: 'person' } }),
      ).toBe(true);
      expect(
        filterEvent!.predicate({ id: '3', attributes: { type: 'place' } }),
      ).toBe(false);
    });

    it('accepts apply_filter args inlined (no `spec` wrapper)', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'apply_filter',
          arguments: JSON.stringify({ type: ['person'] }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('only people', { emitToolCalls: true }),
      );
      const filterEvent = events.find((e) => e.type === 'apply_filter');
      expect(filterEvent).toBeDefined();
    });

    it('translates highlight tool call into a Set<string>', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'highlight',
          arguments: JSON.stringify({ ids: ['a', 'b', 'c'] }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('highlight', { emitToolCalls: true }),
      );
      const hi = events.find(
        (e): e is Extract<ChatEvent, { type: 'highlight' }> =>
          e.type === 'highlight',
      );
      expect(hi).toBeDefined();
      expect(hi!.ids.size).toBe(3);
      expect(hi!.ids.has('a')).toBe(true);
    });

    it('translates focus tool call', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'focus',
          arguments: JSON.stringify({ nodeId: 'adam' }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('focus on adam', { emitToolCalls: true }),
      );
      const focus = events.find(
        (e): e is Extract<ChatEvent, { type: 'focus' }> => e.type === 'focus',
      );
      expect(focus).toBeDefined();
      expect(focus!.nodeId).toBe('adam');
    });

    it('translates annotate tool call', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'annotate',
          arguments: JSON.stringify({ nodeId: 'adam', text: 'first man' }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('add note', { emitToolCalls: true }),
      );
      const ann = events.find(
        (e): e is Extract<ChatEvent, { type: 'annotate' }> =>
          e.type === 'annotate',
      );
      expect(ann).toBeDefined();
      expect(ann!.nodeId).toBe('adam');
      expect(ann!.text).toBe('first man');
    });

    it('silently drops malformed tool calls', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        // Bad JSON
        { type: 'tool_call', name: 'apply_filter', arguments: 'not json' },
        // Unknown tool
        { type: 'tool_call', name: 'launch_missiles', arguments: '{}' },
        // Missing required field
        { type: 'tool_call', name: 'focus', arguments: '{}' },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('chaos', { emitToolCalls: true }),
      );
      // Only the done event should make it through.
      expect(events.map((e) => e.type)).toEqual(['done']);
    });
  });

  describe('cache behavior', () => {
    it('replays cached chat without invoking the provider again', async () => {
      const provider = mockLLMProvider(() => 'hi');
      engine.setProvider(provider);
      engine.setCache(lruCache());

      const first = await collect(engine.chat('hello'));
      expect(provider.getStreamCallCount()).toBe(1);

      const second = await collect(engine.chat('hello'));
      expect(provider.getStreamCallCount()).toBe(1); // no new call
      expect(second).toEqual(first);
    });

    it('different messages keep distinct cache entries', async () => {
      const provider = mockLLMProvider((p) => `echo:${p}`);
      engine.setProvider(provider);
      engine.setCache(lruCache());

      await collect(engine.chat('one'));
      await collect(engine.chat('two'));
      expect(provider.getStreamCallCount()).toBe(2);

      await collect(engine.chat('one'));
      expect(provider.getStreamCallCount()).toBe(2);
    });

    it('replays tool-call events from cache when emitToolCalls=true', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'highlight',
          arguments: JSON.stringify({ ids: ['x'] }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      engine.setCache(lruCache());

      // First call seeds the cache (without emitToolCalls so the live
      // path still iterates fully).
      await collect(engine.chat('hi'));
      // Second call should replay; tool calls visible because we ask for them.
      const events = await collect(engine.chat('hi', { emitToolCalls: true }));
      expect(events.some((e) => e.type === 'highlight')).toBe(true);
    });

    it('does not cache aborted streams', async () => {
      const provider = mockLLMProvider(() => 'hi');
      engine.setProvider(provider);
      engine.setCache(lruCache());

      const ac = new AbortController();
      ac.abort();
      await collect(engine.chat('hi', { signal: ac.signal }));

      // Live, non-aborted call should still hit the provider.
      await collect(engine.chat('hi'));
      expect(provider.getStreamCallCount()).toBeGreaterThanOrEqual(1);
    });

    it('clears cache when the provider instance changes', async () => {
      const a = mockLLMProvider(() => 'A');
      const b = mockLLMProvider(() => 'B');
      engine.setProvider(a);
      engine.setCache(lruCache());

      await collect(engine.chat('q'));
      const before = a.getStreamCallCount();
      // Replay from cache.
      await collect(engine.chat('q'));
      expect(a.getStreamCallCount()).toBe(before);

      // Swap provider — cache should be cleared and `b` should be invoked.
      engine.setProvider(b);
      const events = await collect(engine.chat('q'));
      expect(b.getStreamCallCount()).toBe(1);
      expect(events.some((e) => e.type === 'text' && e.delta === 'B')).toBe(
        true,
      );
    });
  });

  describe('AbortSignal cancellation', () => {
    it('emits a single aborted done when signal is pre-aborted', async () => {
      const provider = mockLLMProvider(() => 'never reached');
      engine.setProvider(provider);
      const ac = new AbortController();
      ac.abort();
      const events = await collect(engine.chat('hi', { signal: ac.signal }));
      expect(events).toEqual([{ type: 'done', reason: 'aborted' }]);
      expect(provider.getStreamCallCount()).toBe(0);
    });

    it('cancels mid-stream when signal aborts during iteration', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        { type: 'text', delta: 'one' },
        { type: 'text', delta: 'two' },
        { type: 'text', delta: 'three' },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const ac = new AbortController();
      const it = engine.chat('hi', { signal: ac.signal });
      const collected: ChatEvent[] = [];
      for await (const ev of it) {
        collected.push(ev);
        if (collected.length === 1) {
          ac.abort();
        }
      }
      const last = collected[collected.length - 1];
      expect(last.type).toBe('done');
      if (last.type === 'done') {
        expect(last.reason).toBe('aborted');
      }
    });
  });

  describe('schema injection', () => {
    it('embeds dataset attribute keys in the prompt', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('hi'));
      const prompt = provider.getLastPrompt() ?? '';
      expect(prompt).toMatch(/type/);
      expect(prompt).toMatch(/era/);
    });

    it('declares the four phase-2 tools to the provider', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('hi'));
      const opts = provider.getLastStreamOptions();
      const names = (opts?.tools ?? []).map((t) => t.name).sort();
      expect(names).toEqual(['annotate', 'apply_filter', 'focus', 'highlight']);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { lruCache } from '../../src/cache/lruCache.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMStreamEvent,
  StreamOptions,
} from '../../src/ai/LLMProvider.js';

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
      // Schema lives in the system message under the new structured-messages
      // path; concatenate role contents so the assertion is shape-agnostic.
      const messages = provider.getLastStreamMessages() ?? [];
      const prompt = messages.map((m) => m.content).join('\n');
      expect(prompt).toMatch(/type/);
      expect(prompt).toMatch(/era/);
    });

    it('declares the built-in tools (phase 2 + set_inferred_visibility) to the provider', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('hi'));
      const opts = provider.getLastStreamOptions();
      const names = (opts?.tools ?? []).map((t) => t.name).sort();
      expect(names).toEqual([
        'annotate',
        'apply_filter',
        'focus',
        'highlight',
        'set_inferred_visibility',
      ]);
    });
  });

  // The chat prompt is a hard contract with the LLM. Tool-use-trained models
  // (e.g. gpt-5.4-mini and similar) treat soft "prefer" wording as permission
  // to skip the text and emit only a tool call — which then gets filtered out
  // of the host's display path, leaving the user with nothing on screen. The
  // prompt MUST require BOTH a streamed text answer AND a `highlight` tool
  // call covering every node referenced by the answer (subject + objects).
  describe('chat prompt contract', () => {
    async function getPrompt(message: string): Promise<string> {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat(message));
      // The contract lives in the system message; concatenate role contents
      // so the assertion is shape-agnostic.
      const messages = provider.getLastStreamMessages() ?? [];
      return messages.map((m) => m.content).join('\n');
    }

    it('requires both text and highlight in every graph-relevant response', async () => {
      const prompt = await getPrompt('Who lived in Eden?');
      // Hard "MUST" contract, not soft "prefer".
      expect(prompt).toContain('MUST');
      expect(prompt).toMatch(/text/i);
      expect(prompt).toMatch(/highlight/);
      // The previous soft phrasing is removed entirely so trained models can
      // not read it as permission to skip text.
      expect(prompt).not.toMatch(/prefer/i);
    });

    it('instructs highlight to cover EVERY referenced node including subjects', async () => {
      const prompt = await getPrompt('Who lived in Eden?');
      // The model must include the subject of the question, not just the
      // objects of the answer (Eden + Adam + Eve, never just Adam + Eve).
      expect(prompt).toMatch(/EVERY node referenced/);
      expect(prompt).toMatch(/subject/);
    });

    it('restricts apply_filter to explicit user filter requests', async () => {
      const prompt = await getPrompt('Who lived in Eden?');
      // apply_filter is for "show only X" / "hide Y" — never auto-applied to
      // questions about the data, because that hides the answer.
      expect(prompt).toMatch(/apply_filter/);
      expect(prompt).toMatch(/explicit/i);
      expect(prompt).toMatch(/show only|hide/i);
    });

    it('allows text-only when no graph entities are relevant', async () => {
      const prompt = await getPrompt('How do I use this?');
      // Out-of-graph questions ("how do I use you?") may be answered with text
      // alone; the "MUST emit highlight" rule applies to graph-relevant turns.
      expect(prompt).toMatch(/no graph relevance|text only/i);
    });

    it('declares highlight as the "every referenced node" tool to the provider', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('hi'));
      const opts = provider.getLastStreamOptions();
      const tool = (opts?.tools ?? []).find((t) => t.name === 'highlight');
      expect(tool).toBeDefined();
      expect(tool!.description).toMatch(/every node referenced/i);
      expect(tool!.description).toMatch(/subject/i);
    });

    it('declares apply_filter as explicit-user-request-only to the provider', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('hi'));
      const opts = provider.getLastStreamOptions();
      const tool = (opts?.tools ?? []).find((t) => t.name === 'apply_filter');
      expect(tool).toBeDefined();
      expect(tool!.description).toMatch(/explicit/i);
      expect(tool!.description).toMatch(/show only|hide/i);
    });
  });

  describe('set_inferred_visibility tool', () => {
    it('translates set_inferred_visibility(true) into a typed event', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'set_inferred_visibility',
          arguments: JSON.stringify({ visible: true }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('show inferred', { emitToolCalls: true }),
      );
      const ev = events.find(
        (e): e is Extract<ChatEvent, { type: 'set_inferred_visibility' }> =>
          e.type === 'set_inferred_visibility',
      );
      expect(ev).toBeDefined();
      expect(ev!.visible).toBe(true);
    });

    it('translates set_inferred_visibility(false)', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'set_inferred_visibility',
          arguments: JSON.stringify({ visible: false }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('hide inferred', { emitToolCalls: true }),
      );
      const ev = events.find((e) => e.type === 'set_inferred_visibility');
      expect(ev).toBeDefined();
      if (ev && ev.type === 'set_inferred_visibility') {
        expect(ev.visible).toBe(false);
      }
    });

    it('drops set_inferred_visibility with non-boolean visible', async () => {
      const provider = mockLLMProvider((): LLMStreamEvent[] => [
        {
          type: 'tool_call',
          name: 'set_inferred_visibility',
          arguments: JSON.stringify({ visible: 'yes' }),
        },
        { type: 'done', reason: 'stop' },
      ]);
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('confused', { emitToolCalls: true }),
      );
      // The malformed tool call is silently dropped; only `done` survives.
      expect(events.map((e) => e.type)).toEqual(['done']);
    });
  });

  // ---------------------------------------------------------------------------
  // Change 1 — embedding-retrieved (or full-catalog) node context
  // ---------------------------------------------------------------------------
  describe('relevant-nodes catalog', () => {
    it('includes a structured catalog (id | title | type | ...) in the system message', async () => {
      // Tier-1 (no embeddings): small graph, the engine should embed the full
      // catalog. Each line: `<id> | <title> | <type> | <other key=value pairs>`
      // so the model can copy ids verbatim.
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('Adam'));
      const messages = provider.getLastStreamMessages();
      expect(messages).toBeDefined();
      const system = messages!.find((m) => m.role === 'system');
      expect(system).toBeDefined();
      // Adam's id in the fixture is `1`; title `Adam`; type `person`.
      expect(system!.content).toMatch(/1 \| Adam \| person/);
      // Eden too — the catalog is full when graph <= K.
      expect(system!.content).toMatch(/3 \| Eden \| place/);
    });

    it('falls back to keyword search when embeddings are not ready', async () => {
      // Force the ranking path: shrink chatContextSize below the fixture
      // node count so collectRelevantNodes must rank. Then strip embed so
      // the engine has no semantic option — keyword is the only path left.
      const smallEngine = new AIEngine(store, new QueryEngine(store), {
        chatContextSize: 2,
      });
      const { SearchEngine } = await import('../../src/store/SearchEngine.js');
      const spy = vi.spyOn(SearchEngine.prototype, 'search');

      let captured: LLMMessage[] | undefined;
      const provider: LLMProvider = {
        name: 'no-embed-mock',
        async complete() {
          return 'ok';
        },
        async *stream(_prompt: string, _opts?: StreamOptions) {
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
        async *streamMessages(messages: LLMMessage[], _opts?: StreamOptions) {
          captured = messages;
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
      };
      smallEngine.setProvider(provider);

      await collect(smallEngine.chat('Eden'));

      // The keyword path ran (no embed provider, graph > K → ranking needed).
      expect(spy).toHaveBeenCalled();
      // Catalog still got built into the system message — Eden is in it.
      expect(captured).toBeDefined();
      const system = captured!.find((m) => m.role === 'system');
      expect(system!.content).toMatch(/3 \| Eden \| place/);
      spy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Change 2 — structured-messages provider interface
  // ---------------------------------------------------------------------------
  describe('streamMessages provider interface', () => {
    it('calls streamMessages with system + user roles when the provider supports it', async () => {
      let streamCalls = 0;
      let messagesCalls = 0;
      let captured: LLMMessage[] | undefined;
      const provider: LLMProvider = {
        name: 'mock-with-messages',
        async complete() {
          return 'ok';
        },
        async *stream(_prompt: string, _opts?: StreamOptions) {
          streamCalls += 1;
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
        async *streamMessages(messages: LLMMessage[], _opts?: StreamOptions) {
          messagesCalls += 1;
          captured = messages;
          yield { type: 'text', delta: 'hi' } as LLMStreamEvent;
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
      };
      engine.setProvider(provider);
      const events = await collect(engine.chat('Who lived in Eden?'));
      expect(messagesCalls).toBe(1);
      expect(streamCalls).toBe(0);
      expect(captured).toBeDefined();
      // Roles: at least one system + one user.
      const roles = captured!.map((m) => m.role);
      expect(roles).toContain('system');
      expect(roles).toContain('user');
      // The events still flow through.
      expect(events.some((e) => e.type === 'text')).toBe(true);
    });

    it('falls back to stream() with a flattened prompt when the provider lacks streamMessages', async () => {
      // Tier-1 fixture: only `stream` is defined.
      let captured: string | undefined;
      const provider: LLMProvider = {
        name: 'legacy-mock',
        async complete() {
          return 'ok';
        },
        async *stream(prompt: string, _opts?: StreamOptions) {
          captured = prompt;
          yield { type: 'text', delta: 'ok' } as LLMStreamEvent;
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
      };
      engine.setProvider(provider);
      await collect(engine.chat('Who lived in Eden?'));
      expect(captured).toBeDefined();
      // The flattened prompt MUST contain the system contract directives
      // (MUST + highlight) AND the user's literal question.
      expect(captured!).toMatch(/MUST/);
      expect(captured!).toMatch(/highlight/);
      expect(captured!).toMatch(/Who lived in Eden\?/);
    });

    it('system message contains the MUST contract and the schema block', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('hi'));
      const messages = provider.getLastStreamMessages();
      const system = messages!.find((m) => m.role === 'system');
      expect(system).toBeDefined();
      expect(system!.content).toMatch(/MUST/);
      expect(system!.content).toMatch(/highlight/);
      // Schema attribute keys (type/era) appear because we re-render the
      // schema block into the system message.
      expect(system!.content).toMatch(/type/);
      expect(system!.content).toMatch(/era/);
    });

    it('user message contains only the user question — no instructions, no schema', async () => {
      const provider = mockLLMProvider(() => 'ok');
      engine.setProvider(provider);
      await collect(engine.chat('Who lived in Eden?'));
      const messages = provider.getLastStreamMessages();
      const user = messages!.find((m) => m.role === 'user');
      expect(user).toBeDefined();
      // Exactly the user's question — no `MUST`, no schema header, no
      // catalog. The instructions belong in the system message.
      expect(user!.content).toBe('Who lived in Eden?');
      expect(user!.content).not.toMatch(/MUST/);
      expect(user!.content).not.toMatch(/Dataset schema/);
    });
  });

  // ---------------------------------------------------------------------------
  // Change 3 — retry once on malformed tool args
  // ---------------------------------------------------------------------------
  describe('malformed tool-call retry', () => {
    it('drops a highlight tool call with empty ids and retries with a corrective system message', async () => {
      // Provider yields a malformed `highlight({})` first; on retry yields a
      // valid one. The host should see ONLY the valid tool call.
      let invocation = 0;
      let secondMessages: LLMMessage[] | undefined;
      const provider: LLMProvider = {
        name: 'retry-mock',
        async complete() {
          return 'ok';
        },
        async *stream(_prompt: string, _opts?: StreamOptions) {
          // Used by the legacy fallback only — not in this test.
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
        async *streamMessages(messages: LLMMessage[], _opts?: StreamOptions) {
          invocation += 1;
          if (invocation === 1) {
            // Malformed: missing required `ids` field.
            yield {
              type: 'tool_call',
              name: 'highlight',
              arguments: '{}',
            } as LLMStreamEvent;
            yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
            return;
          }
          // Second invocation: capture for inspection, emit a valid call.
          secondMessages = messages;
          yield { type: 'text', delta: 'Adam and Eve.' } as LLMStreamEvent;
          yield {
            type: 'tool_call',
            name: 'highlight',
            arguments: JSON.stringify({ ids: ['1', '2', '3'] }),
          } as LLMStreamEvent;
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
      };
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('Who lived in Eden?', { emitToolCalls: true }),
      );
      expect(invocation).toBe(2);
      // The retry path appended a corrective system message.
      expect(secondMessages).toBeDefined();
      const correctives = secondMessages!.filter(
        (m) =>
          m.role === 'system' && /previous tool call/i.test(m.content),
      );
      expect(correctives.length).toBeGreaterThan(0);
      // The bad call MUST NOT leak through. The good one MUST.
      const highlights = events.filter((e) => e.type === 'highlight');
      expect(highlights).toHaveLength(1);
      const hi = highlights[0] as Extract<ChatEvent, { type: 'highlight' }>;
      expect(hi.ids.has('1')).toBe(true);
      expect(hi.ids.has('2')).toBe(true);
      expect(hi.ids.has('3')).toBe(true);
    });

    it('caps retries at 1 — second malformed tool call passes through (still dropped, no third call)', async () => {
      // Even after one corrective retry, if the model is still malformed we
      // give up — drop the bad tool call and fall through with whatever text
      // was emitted. Critically: NO third invocation.
      let invocation = 0;
      const provider: LLMProvider = {
        name: 'retry-cap-mock',
        async complete() {
          return 'ok';
        },
        async *stream(_prompt: string, _opts?: StreamOptions) {
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
        async *streamMessages(_messages: LLMMessage[], _opts?: StreamOptions) {
          invocation += 1;
          // Always malformed — `ids` is an object, not an array.
          yield { type: 'text', delta: `try-${invocation}` } as LLMStreamEvent;
          yield {
            type: 'tool_call',
            name: 'highlight',
            arguments: JSON.stringify({ ids: {} }),
          } as LLMStreamEvent;
          yield { type: 'done', reason: 'stop' } as LLMStreamEvent;
        },
      };
      engine.setProvider(provider);
      const events = await collect(
        engine.chat('Who lived in Eden?', { emitToolCalls: true }),
      );
      // Exactly two invocations — original + one retry. Cap is 1.
      expect(invocation).toBe(2);
      // No highlight events leaked through (both were malformed).
      const highlights = events.filter((e) => e.type === 'highlight');
      expect(highlights).toHaveLength(0);
      // Text from the retry attempt does still flow.
      expect(events.some((e) => e.type === 'text')).toBe(true);
    });
  });
});

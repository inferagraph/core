/**
 * Phase 1 (RAG architecture, 0.8.0) AIEngine behaviors.
 *
 * Covers conversation memory, hybrid retrieval (semantic + keyword + graph
 * expansion), cross-encoder rerank, buildChatMessages additions, and the
 * pure-reducer rewrite of emitWithFallbacks. Each `describe` block
 * corresponds to one architectural concept area.
 */

import { describe, it, expect, vi } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import { inMemoryConversationStore } from '../../src/ai/InMemoryConversationStore.js';
import { inMemoryInferredEdgeStore } from '../../src/ai/InferredEdge.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type {
  LLMMessage,
  LLMStreamEvent,
} from '../../src/ai/LLMProvider.js';
import type { Vector } from '../../src/ai/Embedding.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('cain', { name: 'Cain', type: 'person', content: 'Cain killed his brother Abel.' });
  store.addNode('abel', { name: 'Abel', type: 'person', content: 'Abel was the second son of Adam.' });
  store.addNode('adam', { name: 'Adam', type: 'person', content: 'Adam is the first man.' });
  store.addNode('eve', { name: 'Eve', type: 'person', content: 'Eve is the first woman.' });
  store.addNode('eden', { name: 'Eden', type: 'place', content: 'Eden is the garden of God.' });
  return store;
}

function makeProviderWithEmbeddings(opts?: {
  responder?: (
    messages: LLMMessage[],
  ) => string | LLMStreamEvent[];
  embeddings?: Record<string, Vector>;
  completer?: (prompt: string) => string;
}) {
  const responder =
    opts?.responder ??
    ((): LLMStreamEvent[] => [
      { type: 'text', delta: 'ok' },
      { type: 'done', reason: 'stop' },
    ]);
  const completer = opts?.completer ?? (() => '{"score":0.5,"reason":"ok"}');
  const provider = mockLLMProvider(
    (prompt) => {
      // For non-chat usages (rerank), route through completer.
      return completer(prompt);
    },
    opts?.embeddings,
  );
  // Override streamMessages so we can inspect messages directly.
  const origStreamMessages = provider.streamMessages.bind(provider);
  provider.streamMessages = async function* (
    messages: LLMMessage[],
    o,
  ): AsyncGenerator<LLMStreamEvent, void, unknown> {
    // Capture messages via the mock's existing tracking.
    void origStreamMessages;
    void o;
    // Mirror the stream tracker on the mock.
    (provider as unknown as { _lastMessages?: LLMMessage[] })._lastMessages =
      messages.map((m) => ({ ...m }));
    const resolved = responder(messages);
    if (typeof resolved === 'string') {
      if (resolved.length > 0) yield { type: 'text', delta: resolved };
      yield { type: 'done', reason: 'stop' };
      return;
    }
    let sawDone = false;
    for (const ev of resolved) {
      if (ev.type === 'done') sawDone = true;
      yield ev;
    }
    if (!sawDone) yield { type: 'done', reason: 'stop' };
  };
  return provider;
}

function lastSystemMessage(provider: ReturnType<typeof makeProviderWithEmbeddings>): string {
  const captured = (provider as unknown as { _lastMessages?: LLMMessage[] })
    ._lastMessages;
  if (!captured) return '';
  const sys = captured.find((m) => m.role === 'system');
  return sys?.content ?? '';
}

// ---------------------------------------------------------------------------
// Conversation memory (tests 19-22)
// ---------------------------------------------------------------------------

describe('AIEngine.chat — conversation memory', () => {
  it('fetches prior turns when conversationId is provided and a store is set', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store));
    const provider = makeProviderWithEmbeddings();
    engine.setProvider(provider);
    const convStore = inMemoryConversationStore();
    engine.setConversationStore(convStore);

    await convStore.appendTurn('c1', {
      role: 'user',
      content: 'Tell me about Cain',
      timestamp: 1,
    });
    await convStore.appendTurn('c1', {
      role: 'assistant',
      content: 'Cain killed Abel.',
      timestamp: 2,
      retrievedNodeIds: ['cain', 'abel'],
    });

    await collect(engine.chat('and what then?', { conversationId: 'c1' }));
    const captured =
      (provider as unknown as { _lastMessages?: LLMMessage[] })._lastMessages ??
      [];
    // [system, user-prior, assistant-prior, user-current].
    const userMsgs = captured.filter((m) => m.role === 'user');
    const assistantMsgs = captured.filter((m) => m.role === 'assistant');
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[0].content).toBe('Tell me about Cain');
    expect(userMsgs[1].content).toBe('and what then?');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe('Cain killed Abel.');
  });

  it('appends user + assistant turns to the store after streaming completes', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store));
    const provider = makeProviderWithEmbeddings({
      responder: () => [
        { type: 'text', delta: 'Cain is the firstborn.' },
        {
          type: 'tool_call',
          name: 'highlight',
          arguments: JSON.stringify({ ids: ['cain'] }),
        },
        { type: 'done', reason: 'stop' },
      ],
    });
    engine.setProvider(provider);
    const convStore = inMemoryConversationStore();
    engine.setConversationStore(convStore);

    await collect(
      engine.chat('Tell me about Cain', { conversationId: 'c1' }),
    );

    const turns = await convStore.getTurns('c1', 10);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toBe('Tell me about Cain');
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].content).toContain('Cain is the firstborn.');
    expect(turns[1].retrievedNodeIds).toBeDefined();
    expect(turns[1].retrievedNodeIds!.length).toBeGreaterThan(0);
  });

  it('does NOT use the conversation store when conversationId is omitted', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store));
    const provider = makeProviderWithEmbeddings();
    engine.setProvider(provider);
    const convStore = inMemoryConversationStore();
    const spy = vi.spyOn(convStore, 'getTurns');
    const appendSpy = vi.spyOn(convStore, 'appendTurn');
    engine.setConversationStore(convStore);

    await collect(engine.chat('hello'));

    expect(spy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('injects a pronoun-resolution block when the message has pronouns and prior turn has retrievedNodeIds', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store));
    const provider = makeProviderWithEmbeddings();
    engine.setProvider(provider);
    const convStore = inMemoryConversationStore();
    engine.setConversationStore(convStore);

    await convStore.appendTurn('c1', {
      role: 'user',
      content: 'Tell me about Cain',
      timestamp: 1,
    });
    await convStore.appendTurn('c1', {
      role: 'assistant',
      content: 'Cain killed Abel.',
      timestamp: 2,
      retrievedNodeIds: ['cain', 'abel'],
    });

    await collect(
      engine.chat('what did he do to his brother?', { conversationId: 'c1' }),
    );

    const sys = lastSystemMessage(provider);
    expect(sys).toMatch(/Potentially-referenced entities/i);
    expect(sys).toContain('cain');
    expect(sys).toContain('abel');
  });
});

// ---------------------------------------------------------------------------
// Hybrid retrieval (tests 23-25)
// ---------------------------------------------------------------------------

describe('AIEngine — hybrid retrieval', () => {
  it('merges semantic + keyword + 1-hop graph expansion', async () => {
    const store = makeStore();
    store.addEdge('e1', 'cain', 'abel', { type: 'brother_of' });

    // Semantic embedding store with vectors that score Cain best.
    const eStore = inMemoryEmbeddingStore();
    await eStore.set({
      nodeId: 'cain',
      vector: [1, 0, 0],
      meta: { model: 'mock', modelVersion: '', generatedAt: '', contentHash: 'h-cain' },
    });
    await eStore.set({
      nodeId: 'eve',
      vector: [0.2, 0.8, 0],
      meta: { model: 'mock', modelVersion: '', generatedAt: '', contentHash: 'h-eve' },
    });

    const provider = makeProviderWithEmbeddings({
      embeddings: { __query__: [1, 0, 0] }, // not actually used by mock — see embed override below
    });
    // Force the mock to embed any query → [1, 0, 0] (Cain-aligned).
    const origEmbed = provider.embed.bind(provider);
    provider.embed = async (texts: string[]) => {
      void origEmbed;
      return texts.map(() => [1, 0, 0]);
    };

    const engine = new AIEngine(store, new QueryEngine(store), {
      chatContextSize: 8,
    });
    engine.setProvider(provider);
    engine.setEmbeddingStore(eStore);

    let captured: ReadonlyArray<unknown> | undefined;
    const responder = () => {
      // Surface the catalog block via the captured system message.
      return [
        { type: 'text', delta: 'ok' },
        { type: 'done', reason: 'stop' },
      ] as LLMStreamEvent[];
    };
    provider.streamMessages = async function* (
      messages: LLMMessage[],
    ): AsyncGenerator<LLMStreamEvent, void, unknown> {
      captured = messages;
      const r = responder();
      for (const ev of r) yield ev;
    };

    await collect(engine.chat('Cain', { conversationId: 'c1' }));
    void captured;
    const sys = (captured?.find?.((m) => (m as LLMMessage).role === 'system') as
      | LLMMessage
      | undefined)?.content ?? '';
    // Cain matches keyword AND semantic; Abel comes in via 1-hop expansion
    // from Cain (the explicit brother_of edge).
    expect(sys).toContain('cain');
    expect(sys).toContain('abel');
  });

  it('emits a debug event with phase: retrieval-empty when nothing matches', async () => {
    const store = new GraphStore();
    // Empty store — retrieval cannot find anything.
    const provider = makeProviderWithEmbeddings();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);
    engine.setEmbeddingStore(inMemoryEmbeddingStore());

    const events = await collect(
      engine.chat('Tell me about something', { emitToolCalls: true }),
    );
    const debug = events.find(
      (e) => e.type === 'debug' && e.phase === 'retrieval-empty',
    );
    expect(debug).toBeDefined();
  });

  it('does NOT fall back to alphabetical-first-12 when retrieval is empty', async () => {
    const store = makeStore();
    // No keyword match, no embeddings, no semantic anchor — historically
    // the engine head-truncated the catalog to the first N nodes. The new
    // contract says: empty retrieval stays empty.
    const provider = makeProviderWithEmbeddings();
    const engine = new AIEngine(store, new QueryEngine(store), {
      chatContextSize: 3,
    });
    engine.setProvider(provider);

    let captured: LLMMessage[] | undefined;
    provider.streamMessages = async function* (messages: LLMMessage[]) {
      captured = messages;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done', reason: 'stop' };
    };

    await collect(engine.chat('xyznomatch987'));
    const sys =
      captured?.find((m) => m.role === 'system')?.content ?? '';
    // None of the node ids should appear because keyword / semantic both
    // miss. (They DID appear under the old alphabetical fallback.)
    expect(sys).toContain('(no nodes)');
  });
});

// ---------------------------------------------------------------------------
// Cross-encoder rerank (tests 26-28)
// ---------------------------------------------------------------------------

describe('AIEngine — runRerank', () => {
  it('reorders candidates by score (highest first)', async () => {
    const store = makeStore();
    // Each candidate gets scored by `complete`. We bake scores per node id.
    const scores: Record<string, number> = {
      cain: 0.2,
      abel: 0.9,
      adam: 0.5,
      eve: 0.1,
      eden: 0.0,
    };
    const provider = makeProviderWithEmbeddings({
      completer: (prompt) => {
        for (const id of Object.keys(scores)) {
          if (prompt.includes(`Node id: ${id}`)) {
            return JSON.stringify({ score: scores[id], reason: 'r' });
          }
        }
        return JSON.stringify({ score: 0, reason: 'r' });
      },
    });
    // Pre-load embeddings so hybrid retrieval picks all 5 nodes via the
    // semantic path (mock provider's deterministic embedder gives every
    // node a score against the query).
    const eStore = inMemoryEmbeddingStore();
    for (const id of Object.keys(scores)) {
      await eStore.set({
        nodeId: id,
        vector: [1, 0, 0],
        meta: { model: 'mock', modelVersion: '', generatedAt: '', contentHash: 'h' },
      });
    }
    const engine = new AIEngine(store, new QueryEngine(store), {
      chatContextSize: 12,
      chatRerankEnabled: true,
      chatRerankCandidates: 5,
      chatRerankTopK: 2,
    });
    engine.setProvider(provider);
    engine.setEmbeddingStore(eStore);
    // Force the mock to embed any query → [1, 0, 0] (matches all units).
    provider.embed = async (texts: string[]) => texts.map(() => [1, 0, 0]);

    let captured: LLMMessage[] | undefined;
    provider.streamMessages = async function* (messages: LLMMessage[]) {
      captured = messages;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done', reason: 'stop' };
    };

    await collect(engine.chat('any question'));
    const sys = captured?.find((m) => m.role === 'system')?.content ?? '';
    // The catalog block (one of the prompt sections) lists kept nodes by
    // id. After rerank, only abel + adam should appear in catalog rows.
    const catalogStart = sys.indexOf('Relevant nodes');
    const catalogEnd = sys.indexOf('Edges');
    const catalogSlice =
      catalogStart >= 0
        ? sys.slice(catalogStart, catalogEnd > 0 ? catalogEnd : undefined)
        : '';
    expect(catalogSlice).toContain('abel ');
    expect(catalogSlice).toContain('adam ');
    expect(catalogSlice).not.toContain('eve ');
    expect(catalogSlice).not.toContain('eden ');
  });

  it('caches the rerank result on (conversationId, queryHash, candidateIds)', async () => {
    const store = makeStore();
    let completeCalls = 0;
    const provider = makeProviderWithEmbeddings({
      completer: () => {
        completeCalls += 1;
        return JSON.stringify({ score: 0.5, reason: 'r' });
      },
    });
    // Pre-load embeddings so retrieval finds nodes deterministically.
    const eStore = inMemoryEmbeddingStore();
    for (const id of ['cain', 'abel', 'adam', 'eve', 'eden']) {
      await eStore.set({
        nodeId: id,
        vector: [1, 0, 0],
        meta: { model: 'mock', modelVersion: '', generatedAt: '', contentHash: 'h' },
      });
    }
    const engine = new AIEngine(store, new QueryEngine(store), {
      chatContextSize: 12,
      chatRerankEnabled: true,
      chatRerankCandidates: 5,
      chatRerankTopK: 2,
    });
    engine.setProvider(provider);
    engine.setEmbeddingStore(eStore);
    engine.setConversationStore(inMemoryConversationStore());
    provider.embed = async (texts: string[]) => texts.map(() => [1, 0, 0]);

    await collect(engine.chat('same question', { conversationId: 'c1' }));
    const firstCalls = completeCalls;
    expect(firstCalls).toBeGreaterThan(0);

    await collect(engine.chat('same question', { conversationId: 'c1' }));
    // Second call hits the rerank cache — no new complete() invocations.
    expect(completeCalls).toBe(firstCalls);
  });

  it('skips rerank entirely when chatRerankEnabled is false', async () => {
    const store = makeStore();
    let completeCalls = 0;
    const provider = makeProviderWithEmbeddings({
      completer: () => {
        completeCalls += 1;
        return JSON.stringify({ score: 0.5, reason: 'r' });
      },
    });
    const engine = new AIEngine(store, new QueryEngine(store), {
      chatRerankEnabled: false,
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));
    expect(completeCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildChatMessages additions (tests 29-32)
// ---------------------------------------------------------------------------

describe('AIEngine.buildChatMessages additions', () => {
  it('includes the citation requirement in the system prompt', async () => {
    const store = makeStore();
    const provider = makeProviderWithEmbeddings();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    let captured: LLMMessage[] | undefined;
    provider.streamMessages = async function* (messages: LLMMessage[]) {
      captured = messages;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done', reason: 'stop' };
    };
    await collect(engine.chat('hi'));
    const sys = captured?.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toMatch(/\[\[id\]\]/);
    expect(sys).toMatch(/cite|citation/i);
  });

  it('includes an Edges block listing connected pairs in the relevant set', async () => {
    const store = makeStore();
    store.addEdge('e1', 'cain', 'abel', { type: 'brother_of' });
    const provider = makeProviderWithEmbeddings();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    let captured: LLMMessage[] | undefined;
    provider.streamMessages = async function* (messages: LLMMessage[]) {
      captured = messages;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done', reason: 'stop' };
    };
    await collect(engine.chat('cain'));
    const sys = captured?.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toMatch(/Edges/i);
    expect(sys).toMatch(/cain.*brother_of.*abel|brother_of/);
  });

  it('includes an Inferred relationships block from inferredEdgeStore', async () => {
    const store = makeStore();
    const provider = makeProviderWithEmbeddings();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);
    const eStore = inMemoryEmbeddingStore();
    engine.setEmbeddingStore(eStore);
    const inferredStore = inMemoryInferredEdgeStore();
    await inferredStore.set([
      {
        sourceId: 'cain',
        targetId: 'eden',
        type: 'related_to',
        score: 0.82,
        sources: ['embedding'],
        reasoning: 'Cain came from Eden',
      },
    ]);
    engine.setInferredEdgeStore(inferredStore);

    let captured: LLMMessage[] | undefined;
    provider.streamMessages = async function* (messages: LLMMessage[]) {
      captured = messages;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done', reason: 'stop' };
    };

    await collect(engine.chat('cain'));
    const sys = captured?.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toMatch(/Inferred/i);
    expect(sys).toContain('Cain came from Eden');
    expect(sys).toMatch(/INFERRED.*0\.82|confidence.*0\.82/);
  });

  it('includes a pronoun-resolution block when applicable', async () => {
    // Already covered in the conversation block above, but mirror here for
    // completeness against the buildChatMessages contract.
    const store = makeStore();
    const provider = makeProviderWithEmbeddings();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);
    const cs = inMemoryConversationStore();
    engine.setConversationStore(cs);
    await cs.appendTurn('c1', {
      role: 'user',
      content: 'who is Cain',
      timestamp: 1,
    });
    await cs.appendTurn('c1', {
      role: 'assistant',
      content: 'Cain is...',
      timestamp: 2,
      retrievedNodeIds: ['cain'],
    });

    let captured: LLMMessage[] | undefined;
    provider.streamMessages = async function* (messages: LLMMessage[]) {
      captured = messages;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done', reason: 'stop' };
    };
    await collect(engine.chat('what did he do?', { conversationId: 'c1' }));
    const sys = captured?.find((m) => m.role === 'system')?.content ?? '';
    expect(sys).toMatch(/Potentially-referenced entities/i);
    expect(sys).toContain('cain');
  });
});

// ---------------------------------------------------------------------------
// emitWithFallbacks reducer (tests 33-35)
// ---------------------------------------------------------------------------

describe('AIEngine.emitWithFallbacks (pure-reducer rewrite)', () => {
  it('substitutes embedding-retrieved ids when model emits empty highlight', async () => {
    const store = makeStore();
    // Force keyword match on `cain` so retrieval set contains it.
    const provider = makeProviderWithEmbeddings({
      responder: () => [
        { type: 'text', delta: 'See below.' },
        {
          type: 'tool_call',
          name: 'highlight',
          arguments: JSON.stringify({ ids: [] }),
        },
        { type: 'done', reason: 'stop' },
      ],
    });
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);
    const events = await collect(
      engine.chat('cain', { emitToolCalls: true }),
    );
    const hi = events.find((e) => e.type === 'highlight') as
      | Extract<ChatEvent, { type: 'highlight' }>
      | undefined;
    expect(hi).toBeDefined();
    expect(hi!.ids.has('cain')).toBe(true);
  });

  it('synthesizes a grounded text event from the first retrieved node content when zero text is emitted', async () => {
    const store = makeStore();
    const provider = makeProviderWithEmbeddings({
      responder: () => [
        // No text events at all — only a tool call + done.
        {
          type: 'tool_call',
          name: 'focus',
          arguments: JSON.stringify({ nodeId: 'cain' }),
        },
        { type: 'done', reason: 'stop' },
      ],
    });
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);
    const events = await collect(engine.chat('cain'));
    const text = events.find((e) => e.type === 'text') as
      | Extract<ChatEvent, { type: 'text' }>
      | undefined;
    expect(text).toBeDefined();
    // Synthesized text should be derived from cain's content body, NOT
    // a "Showing Cain, Abel, ..." catalog list.
    expect(text!.delta).not.toMatch(/^Showing /);
    expect(text!.delta).toContain('Cain');
  });

  it('synthesized text is grounded — not a catalog-list "Showing X, Y, Z."', async () => {
    const store = makeStore();
    const provider = makeProviderWithEmbeddings({
      responder: () => [
        { type: 'done', reason: 'stop' }, // genuinely empty
      ],
    });
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);
    const events = await collect(engine.chat('cain'));
    const text = events.find((e) => e.type === 'text') as
      | Extract<ChatEvent, { type: 'text' }>
      | undefined;
    if (text) {
      // If we synthesized anything at all, it must NOT be the old catalog
      // string. Either it matches a node body OR it's a single-node
      // narration grounded in the first retrieved node.
      expect(text.delta).not.toMatch(/^Showing [A-Z][a-z]+, /);
    }
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import { inMemoryEmbeddingStore } from '../../src/ai/InMemoryEmbeddingStore.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type { LLMProvider } from '../../src/ai/LLMProvider.js';

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('1', { name: 'Adam', type: 'person' });
  store.addNode('2', { name: 'Eve', type: 'person' });
  return store;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

/** Build a provider that throws from embed() while still streaming chat fine. */
function failingEmbedProvider(): LLMProvider {
  const base = mockLLMProvider(() => 'reply');
  return {
    ...base,
    name: base.name,
    complete: base.complete.bind(base),
    stream: base.stream.bind(base),
    embed: vi.fn(async () => {
      throw new Error('embed boom');
    }),
  };
}

describe('AIEngine — warmup failure diagnostic surface', () => {
  let store: GraphStore;
  let engine: AIEngine;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store = makeStore();
    engine = new AIEngine(store, new QueryEngine(store));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does NOT log to console.warn when embed() rejects during warmup', async () => {
    engine.setProvider(failingEmbedProvider());
    engine.setEmbeddingStore(inMemoryEmbeddingStore());

    await engine.ensureEmbeddings();

    // The warmup-failure path used to call console.warn(
    //   '[InferaGraph AIEngine] ensureEmbeddings failed:', err
    // ) and console.warn('[InferaGraph AIEngine] embed batch failed:', err).
    // Fix 2 routes both through the chat diagnostic surface instead.
    const aiEngineWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('[InferaGraph AIEngine]'),
    );
    expect(aiEngineWarnings).toEqual([]);
  });

  it('emits a debug event with phase warmup-failed on the next chat() after warmup error', async () => {
    engine.setProvider(failingEmbedProvider());
    engine.setEmbeddingStore(inMemoryEmbeddingStore());

    // Trigger a warmup that will fail (embed throws).
    await engine.ensureEmbeddings();

    // Now run a chat call WITH emitToolCalls=true so tool/debug events surface.
    const events = await collect(
      engine.chat('hello', { emitToolCalls: true }),
    );
    const warmupDebug = events.find(
      (e): e is Extract<ChatEvent, { type: 'debug' }> =>
        e.type === 'debug' && e.phase === 'warmup-failed',
    );
    expect(warmupDebug).toBeDefined();
    expect(warmupDebug!.detail).toMatch(/embed boom/);
  });

  it('does NOT emit warmup-failed when warmup succeeds', async () => {
    // mockLLMProvider with embed support will succeed.
    engine.setProvider(mockLLMProvider({}));
    engine.setEmbeddingStore(inMemoryEmbeddingStore());

    await engine.ensureEmbeddings();

    const events = await collect(
      engine.chat('hello', { emitToolCalls: true }),
    );
    const warmupDebug = events.find(
      (e) => e.type === 'debug' && e.phase === 'warmup-failed',
    );
    expect(warmupDebug).toBeUndefined();
  });

  it('drains the buffered warmup failure after one chat() — does not repeat', async () => {
    engine.setProvider(failingEmbedProvider());
    engine.setEmbeddingStore(inMemoryEmbeddingStore());

    await engine.ensureEmbeddings();

    // First chat surfaces the buffered debug event.
    const first = await collect(engine.chat('hi', { emitToolCalls: true }));
    expect(
      first.some((e) => e.type === 'debug' && e.phase === 'warmup-failed'),
    ).toBe(true);

    // Second chat — no fresh warmup failure has happened, so no repeat.
    const second = await collect(engine.chat('again', { emitToolCalls: true }));
    expect(
      second.some((e) => e.type === 'debug' && e.phase === 'warmup-failed'),
    ).toBe(false);
  });
});

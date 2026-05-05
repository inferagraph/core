import { describe, it, expect } from 'vitest';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import type { LLMStreamEvent } from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('mockLLMProvider.stream', () => {
  it('yields a single text + done event for a string canned response (map mode)', async () => {
    const provider = mockLLMProvider({ hi: 'hello world' });
    const events = await collect(provider.stream('hi'));
    expect(events).toEqual([
      { type: 'text', delta: 'hello world' },
      { type: 'done', reason: 'stop' },
    ]);
  });

  it('yields just a done event when the canned response is empty', async () => {
    const provider = mockLLMProvider({ hi: '' });
    const events = await collect(provider.stream('hi'));
    expect(events).toEqual([{ type: 'done', reason: 'stop' }]);
  });

  it('yields events from an explicit array (function mode)', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'one' },
      { type: 'text', delta: 'two' },
      { type: 'done', reason: 'stop' },
    ]);
    const events = await collect(provider.stream('hi'));
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'done']);
  });

  it('appends a done event when the canned array lacks one', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'one' },
    ]);
    const events = await collect(provider.stream('hi'));
    const dones = events.filter((e) => e.type === 'done');
    expect(dones).toHaveLength(1);
  });

  it('honors a pre-aborted signal', async () => {
    const provider = mockLLMProvider(() => 'never');
    const ac = new AbortController();
    ac.abort();
    const events = await collect(provider.stream('hi', { signal: ac.signal }));
    expect(events).toEqual([{ type: 'done', reason: 'aborted' }]);
  });

  it('tracks stream call count + last options', async () => {
    const provider = mockLLMProvider(() => 'ok');
    expect(provider.getStreamCallCount()).toBe(0);
    await collect(provider.stream('hi', { tools: [] }));
    expect(provider.getStreamCallCount()).toBe(1);
    expect(provider.getLastStreamOptions()).toEqual({ tools: [] });
  });

  it('reset() clears stream call count', async () => {
    const provider = mockLLMProvider(() => 'ok');
    await collect(provider.stream('hi'));
    provider.reset();
    expect(provider.getStreamCallCount()).toBe(0);
    expect(provider.getLastStreamOptions()).toBeUndefined();
  });

  it('complete() collapses an event-array canned response to its text deltas', async () => {
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'foo ' },
      {
        type: 'tool_call',
        name: 'highlight',
        arguments: '{"ids":["x"]}',
      },
      { type: 'text', delta: 'bar' },
      { type: 'done', reason: 'stop' },
    ]);
    expect(await provider.complete('anything')).toBe('foo bar');
  });
});

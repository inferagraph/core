import { describe, it, expect } from 'vitest';
import {
  inMemoryConversationStore,
  type ConversationStore,
  type ConversationTurn,
} from '../../src/ai/InMemoryConversationStore.js';

function turn(
  role: 'user' | 'assistant',
  content: string,
  retrievedNodeIds?: string[],
  timestamp = 1000,
): ConversationTurn {
  return { role, content, timestamp, retrievedNodeIds };
}

describe('InMemoryConversationStore', () => {
  it('round-trips appendTurn / getTurns / clear', async () => {
    const store: ConversationStore = inMemoryConversationStore();
    await store.appendTurn('c1', turn('user', 'who is Cain?', undefined, 1));
    await store.appendTurn('c1', turn('assistant', 'Cain is...', ['cain'], 2));

    const got = await store.getTurns('c1', 10);
    expect(got).toHaveLength(2);
    expect(got[0].content).toBe('who is Cain?');
    expect(got[1].retrievedNodeIds).toEqual(['cain']);

    await store.clear('c1');
    const after = await store.getTurns('c1', 10);
    expect(after).toEqual([]);
  });

  it('getTurns respects the limit (returns the most recent N in chronological order)', async () => {
    const store: ConversationStore = inMemoryConversationStore();
    for (let i = 0; i < 5; i++) {
      await store.appendTurn(
        'c1',
        turn(i % 2 === 0 ? 'user' : 'assistant', `msg-${i}`, undefined, i),
      );
    }
    const limited = await store.getTurns('c1', 3);
    expect(limited).toHaveLength(3);
    // Most recent 3 — msg-2, msg-3, msg-4 in chronological order.
    expect(limited.map((t) => t.content)).toEqual(['msg-2', 'msg-3', 'msg-4']);
  });

  it('keeps conversations isolated by id', async () => {
    const store = inMemoryConversationStore();
    await store.appendTurn('a', turn('user', 'hello-a'));
    await store.appendTurn('b', turn('user', 'hello-b'));
    expect((await store.getTurns('a', 10))[0].content).toBe('hello-a');
    expect((await store.getTurns('b', 10))[0].content).toBe('hello-b');
  });
});

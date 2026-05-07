/**
 * 0.12.0 — `AIEngine.chat()` emits a `text_replace` event with the new
 * `[[token|matched-text]]` wire format. Citations resolve through the
 * WHOLE store (not just the per-turn rerank top-K), so entities outside
 * `relevantNodes` (e.g. Seth in a turn focused on Adam) still cite if
 * their title appears in the response.
 *
 * Per memory `feedback_tdd_discipline.md` — failing test FIRST.
 */

import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import type { ChatEvent } from '../../src/ai/ChatEvent.js';
import type { LLMStreamEvent } from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('uuid-cain', {
    name: 'Cain',
    type: 'person',
    slug: 'cain',
    content: 'Firstborn son of Adam and Eve. Slew his brother Abel.',
  });
  store.addNode('uuid-abel', {
    name: 'Abel',
    type: 'person',
    slug: 'abel',
    content: 'Brother of Cain.',
  });
  store.addNode('uuid-adam', {
    name: 'Adam',
    type: 'person',
    slug: 'adam',
    content: 'First man.',
  });
  store.addNode('uuid-eve', {
    name: 'Eve',
    type: 'person',
    slug: 'eve',
    content: 'First woman.',
  });
  store.addNode('uuid-seth', {
    name: 'Seth',
    type: 'person',
    slug: 'seth',
    content: 'Third son of Adam and Eve.',
  });
  store.addNode('uuid-the-fall', {
    name: 'the Fall',
    type: 'event',
    slug: 'the-fall',
    content: 'The fall of man.',
  });
  store.addNode('uuid-nod', {
    name: 'land of Nod',
    type: 'place',
    slug: 'land-of-nod',
    content: 'Cain was banished there.',
  });
  return store;
}

describe('AIEngine.chat — server-side citation injection (0.12.0 wire)', () => {
  const productionShapeText =
    'Firstborn son of Adam and Eve. Slew his brother Abel and was exiled to the land of Nod.';

  it('emits a text_replace event with `[[token|matched]]` tokens for every entity reference', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: productionShapeText },
      { type: 'done', reason: 'stop' },
    ]);
    engine.setProvider(provider);

    const events = await collect(engine.chat('Tell me about Cain.'));
    const replace = events.find(
      (e): e is Extract<ChatEvent, { type: 'text_replace' }> =>
        e.type === 'text_replace',
    );
    expect(replace).toBeDefined();
    expect(replace!.text).toContain('[[adam|Adam]]');
    expect(replace!.text).toContain('[[eve|Eve]]');
    expect(replace!.text).toContain('[[abel|Abel]]');
    expect(replace!.text).toContain('[[land-of-nod|land of Nod]]');

    // Order: text deltas come first, then text_replace, then done.
    const types = events.map((e) => e.type);
    const lastTextIdx = types.lastIndexOf('text');
    const replaceIdx = types.indexOf('text_replace');
    const doneIdx = types.indexOf('done');
    expect(replaceIdx).toBeGreaterThan(lastTextIdx);
    expect(replaceIdx).toBeLessThan(doneIdx);
  });

  it('cites an entity whose title appears in the response even when it is outside the per-turn relevantNodes', async () => {
    // Seth is in the store but not necessarily a top-K rerank match for
    // "tell me about Adam" — the injector now resolves against the
    // whole store via buildCitationCandidates, so Seth is cited if the
    // model mentions him.
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: 'Father of Cain, Abel, and Seth.' },
      { type: 'done', reason: 'stop' },
    ]);
    engine.setProvider(provider);

    const events = await collect(engine.chat('Tell me about Adam.'));
    const replace = events.find(
      (e): e is Extract<ChatEvent, { type: 'text_replace' }> =>
        e.type === 'text_replace',
    );
    expect(replace).toBeDefined();
    expect(replace!.text).toBe(
      'Father of [[cain|Cain]], [[abel|Abel]], and [[seth|Seth]].',
    );
  });

  it('does NOT emit text_replace when citationKey is undefined', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store));
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: productionShapeText },
      { type: 'done', reason: 'stop' },
    ]);
    engine.setProvider(provider);

    const events = await collect(engine.chat('hi'));
    expect(events.find((e) => e.type === 'text_replace')).toBeUndefined();
  });

  it('does NOT emit a redundant text_replace when the model already returned the cited shape', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    const alreadyCited =
      'Firstborn son of [[adam|Adam]] and [[eve|Eve]]. Slew his brother [[abel|Abel]] and was exiled to the [[land-of-nod|land of Nod]].';
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: alreadyCited },
      { type: 'done', reason: 'stop' },
    ]);
    engine.setProvider(provider);

    const events = await collect(engine.chat('Tell me about Cain.'));
    expect(events.find((e) => e.type === 'text_replace')).toBeUndefined();
  });
});

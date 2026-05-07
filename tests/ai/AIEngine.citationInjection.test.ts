/**
 * 0.11.0 — `AIEngine.chat()` emits a `text_replace` event after the model
 * stream completes when injected citations differ from the streamed text.
 * This makes citations a guaranteed property of the chat output rather
 * than something the model might forget.
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
  store.addNode('uuid-nod', {
    name: 'land of Nod',
    type: 'place',
    slug: 'land-of-nod',
    content: 'Cain was banished there.',
  });
  return store;
}

describe('AIEngine.chat — server-side citation injection', () => {
  const productionShapeText =
    'Firstborn son of Adam and Eve. Slew his brother Abel and was exiled to the land of Nod.';

  it('emits a text_replace event with [[citationKey]] tokens when the model omits citations', async () => {
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
    expect(replace!.text).toContain('Adam [[adam]]');
    expect(replace!.text).toContain('Eve [[eve]]');
    expect(replace!.text).toContain('Abel [[abel]]');
    expect(replace!.text).toContain('land of Nod [[land-of-nod]]');

    // Order: text deltas come first, then text_replace, then done.
    const types = events.map((e) => e.type);
    const lastTextIdx = types.lastIndexOf('text');
    const replaceIdx = types.indexOf('text_replace');
    const doneIdx = types.indexOf('done');
    expect(replaceIdx).toBeGreaterThan(lastTextIdx);
    expect(replaceIdx).toBeLessThan(doneIdx);
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

  it('does NOT emit a redundant text_replace when the model already cited correctly', async () => {
    const store = makeStore();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    const alreadyCited =
      'Firstborn son of Adam [[adam]] and Eve [[eve]]. Slew his brother Abel [[abel]] and was exiled to the land of Nod [[land-of-nod]].';
    const provider = mockLLMProvider((): LLMStreamEvent[] => [
      { type: 'text', delta: alreadyCited },
      { type: 'done', reason: 'stop' },
    ]);
    engine.setProvider(provider);

    const events = await collect(engine.chat('Tell me about Cain.'));
    expect(events.find((e) => e.type === 'text_replace')).toBeUndefined();
  });
});

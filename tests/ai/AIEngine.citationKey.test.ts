/**
 * 0.9.4 — citationKey config aligns the catalog id with the cite-token example.
 *
 * The 0.9.3 strengthened citation prompt instructs the model to cite using
 * the catalog's first column. But Bible Graph's catalog id is a UUID while
 * the example shows a slug-shaped token (`Cain [[cain]]`). Tool-use-trained
 * models read the contradiction as "the rule does not match the data" and
 * silently drop citations for the whole turn.
 *
 * Fix: add a `citationKey` config that names a node attribute whose value
 * is the citation token (e.g. `'slug'`). When set, the catalog renders a
 * 4th column carrying that value, and the system prompt instructs the
 * model to cite using the LAST column. When unset, behavior matches 0.9.3
 * except the example uses generic `[[node-id-N]]` placeholders so it no
 * longer contradicts UUID-shaped catalog ids.
 *
 * Per memory `feedback_tdd_discipline.md` — failing test FIRST.
 */

import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import type { NodeData } from '../../src/types.js';
import type {
  LLMMessage,
  LLMStreamEvent,
} from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeNode(id: string, attrs: Record<string, unknown>): NodeData {
  return { id, attributes: attrs };
}

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('uuid-cain', {
    name: 'Cain',
    type: 'person',
    slug: 'cain',
    content: 'Cain slew Abel.',
  });
  store.addNode('uuid-abel', {
    name: 'Abel',
    type: 'person',
    slug: 'abel',
    content: 'Abel was the brother of Cain.',
  });
  return store;
}

function captureSystemPrompt(): {
  provider: ReturnType<typeof mockLLMProvider>;
  getSystemPrompt: () => string;
} {
  const provider = mockLLMProvider(() => '');
  let captured: LLMMessage[] | undefined;
  provider.streamMessages = async function* (
    messages: LLMMessage[],
  ): AsyncGenerator<LLMStreamEvent, void, unknown> {
    captured = messages;
    yield { type: 'text', delta: 'ok' };
    yield { type: 'done', reason: 'stop' };
  };
  return {
    provider,
    getSystemPrompt: () =>
      captured?.find((m) => m.role === 'system')?.content ?? '',
  };
}

describe('AIEngine renderCatalogBlock — citationKey behavior', () => {
  it('without citationKey emits 3-column rows (back-compat)', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    // The row appears as `<id> | <title> | <type>` followed by extras.
    // No 4th " | " column carrying a citation token.
    const cainLine = sys
      .split('\n')
      .find((l) => l.startsWith('uuid-cain | Cain | person'));
    expect(cainLine).toBeDefined();
    // The extras section follows, but NO trailing " | cain" citation column.
    expect(cainLine).not.toMatch(/ \| cain$/);
  });

  it('with citationKey appends node.attributes[key] as a trailing column', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    const cainLine = sys
      .split('\n')
      .find((l) => l.startsWith('uuid-cain |'));
    expect(cainLine).toBeDefined();
    expect(cainLine!.endsWith(' | cain')).toBe(true);

    const abelLine = sys
      .split('\n')
      .find((l) => l.startsWith('uuid-abel |'));
    expect(abelLine).toBeDefined();
    expect(abelLine!.endsWith(' | abel')).toBe(true);
  });

  it('with citationKey falls back to node.id when the attribute is missing', () => {
    const store = new GraphStore();
    store.addNode('uuid-noah', {
      name: 'Noah',
      type: 'person',
      // no slug
    });
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    const node = makeNode('uuid-noah', { name: 'Noah', type: 'person' });
    const messages = engine.buildChatMessages('hi', new Map(), [node]);
    const sys = messages.find((m) => m.role === 'system')!.content;
    const noahLine = sys
      .split('\n')
      .find((l) => l.startsWith('uuid-noah |'));
    expect(noahLine).toBeDefined();
    expect(noahLine!.endsWith(' | uuid-noah')).toBe(true);
  });

  it('with citationKey ignores non-string attribute values (falls back to node.id)', () => {
    const store = new GraphStore();
    store.addNode('uuid-x', {
      name: 'X',
      type: 'person',
      slug: 42, // not a string
    });
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    const node = makeNode('uuid-x', {
      name: 'X',
      type: 'person',
      slug: 42,
    });
    const messages = engine.buildChatMessages('hi', new Map(), [node]);
    const sys = messages.find((m) => m.role === 'system')!.content;
    const xLine = sys.split('\n').find((l) => l.startsWith('uuid-x |'));
    expect(xLine).toBeDefined();
    expect(xLine!.endsWith(' | uuid-x')).toBe(true);
  });
});

describe('AIEngine.buildChatMessages — citation prompt branches on citationKey', () => {
  it('with citationKey set, references the LAST column and uses a slug-shaped example', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    expect(sys).toContain('LAST column');
    expect(sys).toContain('Cain [[cain]]');
  });

  it('with citationKey set, adds a note that highlight()/focus() use the FIRST column', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    expect(sys).toContain('FIRST column');
    expect(sys).toMatch(/highlight\(\).*FIRST column|FIRST column.*highlight\(\)/s);
  });

  it('without citationKey set, references the first column and uses generic [[node-id-N]] placeholders', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    expect(sys).toContain('first ` | `');
    expect(sys).toContain('[[node-id-1]]');
    expect(sys).toContain('[[node-id-2]]');
    // The slug-shaped example must NOT appear when citationKey is unset
    // (this is the 0.9.4 fix — it was contradicting UUID-shaped catalog ids).
    expect(sys).not.toContain('Cain [[cain]]');
  });
});

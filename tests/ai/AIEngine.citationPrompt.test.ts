/**
 * 0.9.3 — citation requirement strengthened.
 *
 * The chat system-prompt previously stated `Cite every entity ... using the
 * syntax [[id]] after the entity's first mention.` That soft "cite" verb is
 * read by tool-use-trained models as optional. We replicate the hard "MUST"
 * framing already used for the `highlight()` tool higher in the same prompt.
 *
 * Per memory `feedback_inferagraph_chat_text_plus_full_visual.md` — soft
 * "prefer" verbs fail; explicit MUST/REQUIRED framing works. Per memory
 * `feedback_tdd_discipline.md` — failing test FIRST, then implement.
 */

import { describe, it, expect } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';
import type {
  LLMMessage,
  LLMStreamEvent,
} from '../../src/ai/LLMProvider.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeStore(): GraphStore {
  const store = new GraphStore();
  store.addNode('cain', {
    name: 'Cain',
    type: 'person',
    content: 'Cain slew Abel.',
  });
  store.addNode('abel', {
    name: 'Abel',
    type: 'person',
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

describe('AIEngine.buildChatMessages — citation requirement is mandatory', () => {
  it('emits the hard "REQUIRED, NOT OPTIONAL" framing', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    expect(getSystemPrompt()).toContain('REQUIRED, NOT OPTIONAL');
  });

  it('shows a concrete "Cain [[cain]]" example so the format is unambiguous', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    expect(getSystemPrompt()).toContain('Cain [[cain]]');
  });

  it('shows a "UNCITED, FORBIDDEN" counterexample', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    expect(getSystemPrompt()).toContain('UNCITED, FORBIDDEN');
  });

  it('clarifies that highlight() does NOT substitute for [[id]] citations', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    expect(sys).toMatch(/highlight\(\).*NOT substitutes|NOT substitutes/);
  });
});

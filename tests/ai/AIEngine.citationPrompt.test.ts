/**
 * 0.9.3 — citation rule appears in the prompt.
 *
 * 0.11.0 update: deterministic citation injection now guarantees `[[id]]`
 * tokens regardless of the model's text shape, so the prompt no longer
 * needs alarmist "REQUIRED, NOT OPTIONAL" / "UNCITED, FORBIDDEN" framing.
 * Belt-and-suspenders: keep the rule in the prompt (sometimes saves a
 * post-processor pass) but with neutral wording. These tests now pin the
 * surviving signal — the rule is still present, the example is still
 * concrete, and the model is still pointed at the right column.
 *
 * Per memory `feedback_tdd_discipline.md` — failing test FIRST.
 *
 * 0.9.4 update: the slug-shaped concrete example (`Cain [[cain]]`) now
 * appears only when the engine is configured with `citationKey`. The
 * tests that assert that example pass `citationKey: 'slug'` so the engine
 * emits the slug-shaped example. See `AIEngine.citationKey.test.ts` for
 * the unset-branch coverage.
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

describe('AIEngine.buildChatMessages — citation rule is present', () => {
  it('points the model at the citation token format `[[id]]`', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    expect(sys).toContain('Citations:');
    expect(sys).toContain('[[id]]');
  });

  it('shows a concrete "Cain [[cain]]" example so the format is unambiguous', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    // 0.9.4: slug-shaped examples now require citationKey. With it set, the
    // catalog gains a 4th slug column and the example matches the catalog.
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    expect(getSystemPrompt()).toContain('Cain [[cain]]');
  });

  it('mentions that the host injects citations automatically when the model skips them', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    expect(getSystemPrompt()).toMatch(/host injects citations automatically/);
  });

  it('points tool calls (highlight/focus) at the FIRST column when citationKey is set', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const sys = getSystemPrompt();
    expect(sys).toMatch(/highlight\(\).*FIRST column|FIRST column/);
  });
});

/**
 * 0.9.5 — host-agnostic placeholders in chat-prompt tool-call examples.
 *
 * The "Examples:" section of `buildChatMessages` previously hard-coded
 * Bible-Graph-specific slugs in its tool-call demos:
 *
 *   highlight(["garden-of-eden", "adam", "eve"])
 *   highlight(["noah"])
 *   focus("noah")
 *
 * Those are slug-shaped, but the library is host-agnostic: hosts may key
 * nodes by UUID, opaque ids, or anything else. A literal-slug demo
 * misleads UUID-keyed hosts about the SHAPE of valid `highlight()` /
 * `focus()` arguments and contradicts the catalog rows the model is
 * actually reading.
 *
 * Fix: replace the slug literals with `<node-id-N>` / `<node-id>`
 * placeholders. The model still sees the call SHAPE without thinking
 * the literal id is real.
 *
 * IMPORTANT: the citation example branch under `citationKey` is a
 * different concern (the example IS supposed to be slug-shaped there,
 * because the `citationKey` config aligns the catalog's last column
 * with the cite token). Tests below scope to the tool-call examples
 * section, which is above the catalog block.
 *
 * Per memory `feedback_tdd_discipline.md` — failing test FIRST.
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

/**
 * Slice the system prompt so we only inspect the "Examples:" tool-call
 * section — i.e. everything up to (but not including) the catalog block,
 * which is where the citation-example branch lives. The catalog header
 * is `Relevant nodes (use these ids verbatim ...)`.
 */
function examplesSection(sys: string): string {
  const cutoff = sys.indexOf('Relevant nodes (');
  expect(cutoff).toBeGreaterThan(0);
  return sys.slice(0, cutoff);
}

describe('AIEngine.buildChatMessages — tool-call examples are host-agnostic', () => {
  it('does NOT contain Bible-Graph-specific slugs in the tool-call examples', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const examples = examplesSection(getSystemPrompt());

    // Tool-call examples must not bake in Bible-Graph identifiers.
    expect(examples).not.toContain('garden-of-eden');
    expect(examples).not.toContain('"adam"');
    expect(examples).not.toContain('"eve"');
    expect(examples).not.toContain('"noah"');
    expect(examples).not.toContain('"cain"');
    expect(examples).not.toContain('"abel"');
    expect(examples).not.toContain('land-of-nod');
  });

  it('uses generic <node-id> placeholders in the highlight() and focus() examples', async () => {
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store));
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    const examples = examplesSection(getSystemPrompt());

    // The shape of a multi-id highlight() call.
    expect(examples).toMatch(
      /highlight\(\["<node-id-1>", "<node-id-2>"(?:, "<node-id-3>")?\]\)/,
    );
    // A single-id highlight() example.
    expect(examples).toMatch(/highlight\(\["<node-id>"\]\)/);
    // A focus() example with the same placeholder shape.
    expect(examples).toContain('focus("<node-id>")');
  });

  it('keeps the citationKey-set branch slug-shaped example intact (Cain [[cain]])', async () => {
    // The slug-shaped citation example is intentional under citationKey
    // (per 0.9.4); this guard ensures the 0.9.5 cleanup did not also
    // touch the citation branch.
    const store = makeStore();
    const { provider, getSystemPrompt } = captureSystemPrompt();
    const engine = new AIEngine(store, new QueryEngine(store), {
      citationKey: 'slug',
    });
    engine.setProvider(provider);

    await collect(engine.chat('hi'));

    expect(getSystemPrompt()).toContain('Cain [[cain]]');
  });
});

import type {
  CompleteOptions,
  LLMProvider,
  LLMStreamEvent,
  StreamOptions,
} from './LLMProvider.js';

/**
 * Test-only mock provider. Accepts either:
 *   - a static map of `prompt → response` (exact-match lookup), or
 *   - a function `(prompt, opts) => string | Promise<string>` for dynamic responses.
 *
 * In addition to satisfying {@link LLMProvider}, the returned object exposes
 * `getCallCount()` and `getLastPrompt()` for test inspection. These are mock-
 * only conveniences and are NOT part of the `LLMProvider` interface — runtime
 * code that depends on them is a smell.
 *
 * Streaming behavior:
 *   - When the canned source is a map, the value is treated as a single text
 *     delta. The mock yields `{type: 'text', delta}` then `{type: 'done',
 *     reason: 'stop'}`.
 *   - When the canned source is a function, it may return a string (single
 *     text delta) OR an array of {@link LLMStreamEvent} (explicit sequence).
 *     Returning an explicit sequence lets tests exercise the tool-call path.
 *     A trailing `done` event is auto-appended if the array doesn't include
 *     one — tests should normally include it themselves to verify the
 *     stream-end contract.
 */
export interface MockLLMProvider extends LLMProvider {
  /** Number of times `complete` has been called since construction. */
  getCallCount(): number;
  /** The last prompt passed to `complete` or `stream`, or `undefined` if never called. */
  getLastPrompt(): string | undefined;
  /** Number of times `stream` has been called since construction. */
  getStreamCallCount(): number;
  /** The last `StreamOptions` passed to `stream`. */
  getLastStreamOptions(): StreamOptions | undefined;
  /** Reset call-count + last-prompt state without re-creating the mock. */
  reset(): void;
}

/**
 * Construct a {@link MockLLMProvider}. Used by the package's own tests AND by
 * downstream consumers that want a no-op baseline before wiring a real provider.
 *
 * When the canned source is a map, an unmatched prompt yields `''`. Tests that
 * care about the unmatched case should use the function form and throw.
 */
export function mockLLMProvider(
  canned:
    | Record<string, string>
    | ((
        prompt: string,
        opts?: CompleteOptions | StreamOptions,
      ) =>
        | string
        | LLMStreamEvent[]
        | Promise<string | LLMStreamEvent[]>),
): MockLLMProvider {
  let callCount = 0;
  let streamCallCount = 0;
  let lastPrompt: string | undefined;
  let lastStreamOptions: StreamOptions | undefined;

  const isFn = typeof canned === 'function';

  async function resolveCanned(
    prompt: string,
    opts?: CompleteOptions | StreamOptions,
  ): Promise<string | LLMStreamEvent[]> {
    if (isFn) {
      return await (
        canned as (
          p: string,
          o?: CompleteOptions | StreamOptions,
        ) =>
          | string
          | LLMStreamEvent[]
          | Promise<string | LLMStreamEvent[]>
      )(prompt, opts);
    }
    const map = canned as Record<string, string>;
    return Object.prototype.hasOwnProperty.call(map, prompt) ? map[prompt] : '';
  }

  return {
    name: 'mock',

    async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
      callCount += 1;
      lastPrompt = prompt;
      const resolved = await resolveCanned(prompt, opts);
      if (typeof resolved === 'string') return resolved;
      // If the canned source returned an event array via the streaming
      // form, collapse it to a concatenation of text deltas so `complete`
      // still returns a single string.
      let collapsed = '';
      for (const ev of resolved) {
        if (ev.type === 'text') collapsed += ev.delta;
      }
      return collapsed;
    },

    async *stream(
      prompt: string,
      opts?: StreamOptions,
    ): AsyncGenerator<LLMStreamEvent, void, unknown> {
      streamCallCount += 1;
      lastPrompt = prompt;
      lastStreamOptions = opts;

      // Honour pre-aborted signals: emit a single `done` and stop.
      if (opts?.signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }

      const resolved = await resolveCanned(prompt, opts);

      // Re-check abort after the (possibly async) canned resolver.
      if (opts?.signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }

      if (typeof resolved === 'string') {
        if (resolved.length > 0) {
          yield { type: 'text', delta: resolved };
        }
        yield { type: 'done', reason: 'stop' };
        return;
      }

      let sawDone = false;
      for (const ev of resolved) {
        if (opts?.signal?.aborted) {
          yield { type: 'done', reason: 'aborted' };
          return;
        }
        if (ev.type === 'done') sawDone = true;
        yield ev;
      }
      if (!sawDone) {
        yield { type: 'done', reason: 'stop' };
      }
    },

    getCallCount(): number {
      return callCount;
    },

    getLastPrompt(): string | undefined {
      return lastPrompt;
    },

    getStreamCallCount(): number {
      return streamCallCount;
    },

    getLastStreamOptions(): StreamOptions | undefined {
      return lastStreamOptions;
    },

    reset(): void {
      callCount = 0;
      streamCallCount = 0;
      lastPrompt = undefined;
      lastStreamOptions = undefined;
    },
  };
}

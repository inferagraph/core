import type { CompleteOptions, LLMProvider } from './LLMProvider.js';

/**
 * Test-only mock provider. Accepts either:
 *   - a static map of `prompt → response` (exact-match lookup), or
 *   - a function `(prompt, opts) => string | Promise<string>` for dynamic responses.
 *
 * In addition to satisfying {@link LLMProvider}, the returned object exposes
 * `getCallCount()` and `getLastPrompt()` for test inspection. These are mock-
 * only conveniences and are NOT part of the `LLMProvider` interface — runtime
 * code that depends on them is a smell.
 */
export interface MockLLMProvider extends LLMProvider {
  /** Number of times `complete` has been called since construction. */
  getCallCount(): number;
  /** The last prompt passed to `complete`, or `undefined` if never called. */
  getLastPrompt(): string | undefined;
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
    | ((prompt: string, opts?: CompleteOptions) => string | Promise<string>),
): MockLLMProvider {
  let callCount = 0;
  let lastPrompt: string | undefined;

  const isFn = typeof canned === 'function';

  return {
    name: 'mock',

    async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
      callCount += 1;
      lastPrompt = prompt;
      if (isFn) {
        return await canned(prompt, opts);
      }
      const map = canned as Record<string, string>;
      return Object.prototype.hasOwnProperty.call(map, prompt) ? map[prompt] : '';
    },

    getCallCount(): number {
      return callCount;
    },

    getLastPrompt(): string | undefined {
      return lastPrompt;
    },

    reset(): void {
      callCount = 0;
      lastPrompt = undefined;
    },
  };
}

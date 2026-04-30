import { describe, it, expect } from 'vitest';
import { mockLLMProvider } from '../../src/ai/MockLLMProvider.js';

describe('mockLLMProvider', () => {
  describe('canned map mode', () => {
    it('returns the canned response for an exact-match prompt', async () => {
      const provider = mockLLMProvider({ hello: 'world' });
      expect(await provider.complete('hello')).toBe('world');
    });

    it('returns "" for an unmatched prompt', async () => {
      const provider = mockLLMProvider({ hello: 'world' });
      expect(await provider.complete('unrelated')).toBe('');
    });

    it('uses the provider name "mock"', () => {
      const provider = mockLLMProvider({});
      expect(provider.name).toBe('mock');
    });
  });

  describe('canned function mode', () => {
    it('invokes the function with the prompt + opts', async () => {
      const calls: Array<[string, unknown]> = [];
      const provider = mockLLMProvider((prompt, opts) => {
        calls.push([prompt, opts]);
        return `echo:${prompt}`;
      });
      expect(await provider.complete('hi', { format: 'json' })).toBe('echo:hi');
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('hi');
      expect((calls[0][1] as { format?: string }).format).toBe('json');
    });

    it('supports async response functions', async () => {
      const provider = mockLLMProvider(async (prompt) => {
        await Promise.resolve();
        return `async:${prompt}`;
      });
      expect(await provider.complete('hi')).toBe('async:hi');
    });
  });

  describe('call inspection helpers', () => {
    it('tracks call count', async () => {
      const provider = mockLLMProvider({});
      expect(provider.getCallCount()).toBe(0);
      await provider.complete('a');
      await provider.complete('b');
      expect(provider.getCallCount()).toBe(2);
    });

    it('tracks the last prompt', async () => {
      const provider = mockLLMProvider({});
      expect(provider.getLastPrompt()).toBeUndefined();
      await provider.complete('first');
      expect(provider.getLastPrompt()).toBe('first');
      await provider.complete('second');
      expect(provider.getLastPrompt()).toBe('second');
    });

    it('reset() clears call count and last prompt', async () => {
      const provider = mockLLMProvider({});
      await provider.complete('foo');
      provider.reset();
      expect(provider.getCallCount()).toBe(0);
      expect(provider.getLastPrompt()).toBeUndefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import type {
  LLMMessage,
  LLMProvider,
  LLMRole,
  LLMStreamEvent,
} from '../../src/ai/LLMProvider.js';

describe('LLMMessage', () => {
  it('has structural shape { role, content }', () => {
    const msg: LLMMessage = { role: 'user', content: 'hi' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hi');
  });

  it('LLMRole accepts system | user | assistant', () => {
    const roles: LLMRole[] = ['system', 'user', 'assistant'];
    for (const r of roles) {
      const m: LLMMessage = { role: r, content: '' };
      expect(['system', 'user', 'assistant']).toContain(m.role);
    }
  });
});

describe('LLMProvider', () => {
  it('streamMessages is optional on the interface', () => {
    // Provider implementations may omit streamMessages; only `name`,
    // `complete`, and `stream` are required. The type-level test below
    // pins this: the assignment compiles ONLY if streamMessages is
    // optional.
    const minimal: LLMProvider = {
      name: 'minimal',
      async complete() {
        return '';
      },
      // eslint-disable-next-line require-yield
      async *stream(): AsyncGenerator<LLMStreamEvent, void, unknown> {
        return;
      },
    };
    expect(minimal.streamMessages).toBeUndefined();
  });
});

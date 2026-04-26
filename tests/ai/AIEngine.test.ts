import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { LLMProvider } from '../../src/ai/LLMProvider.js';
import type { LLMCompletionRequest, LLMCompletionResponse } from '../../src/types.js';

class MockProvider extends LLMProvider {
  readonly name = 'mock';
  lastRequest: LLMCompletionRequest | null = null;

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    this.lastRequest = request;
    return { content: 'Adam was the first human. Eve was his wife.', usage: { inputTokens: 100, outputTokens: 20 } };
  }

  isConfigured(): boolean {
    return true;
  }
}

describe('AIEngine', () => {
  let store: GraphStore;
  let queryEngine: QueryEngine;
  let engine: AIEngine;

  beforeEach(() => {
    store = new GraphStore();
    queryEngine = new QueryEngine(store);
    engine = new AIEngine(store, queryEngine);
    store.addNode('1', { name: 'Adam', type: 'person', gender: 'male' });
    store.addNode('2', { name: 'Eve', type: 'person', gender: 'female' });
    store.addEdge('e1', '1', '2', { type: 'husband_of' });
  });

  it('should throw without provider', async () => {
    await expect(engine.query('Who is Adam?')).rejects.toThrow('No LLM provider configured');
  });

  it('should query with provider', async () => {
    engine.setProvider(new MockProvider());
    const result = await engine.query('Who is Adam?');
    expect(result.answer).toContain('Adam');
    expect(result.highlightedNodeIds).toContain('1');
  });

  it('should set and get provider', () => {
    const provider = new MockProvider();
    engine.setProvider(provider);
    expect(engine.getProvider()).toBe(provider);
  });

  describe('custom system prompt', () => {
    it('should use default generic prompt when no config provided', async () => {
      const provider = new MockProvider();
      engine.setProvider(provider);
      await engine.query('Who is Adam?');
      const systemMessage = provider.lastRequest!.messages[0];
      expect(systemMessage.content).toContain('You are a knowledgeable assistant');
    });

    it('should use custom system prompt when configured', async () => {
      const customEngine = new AIEngine(store, queryEngine, {
        systemPrompt: 'You are a custom domain expert.',
      });
      const provider = new MockProvider();
      customEngine.setProvider(provider);
      await customEngine.query('Who is Adam?');
      const systemMessage = provider.lastRequest!.messages[0];
      expect(systemMessage.content).toContain('You are a custom domain expert.');
    });

    it('should allow reconfiguring system prompt via configure()', async () => {
      const provider = new MockProvider();
      engine.setProvider(provider);
      engine.configure({ systemPrompt: 'Updated prompt.' });
      await engine.query('Who is Adam?');
      const systemMessage = provider.lastRequest!.messages[0];
      expect(systemMessage.content).toContain('Updated prompt.');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { LLMProvider } from '../../src/ai/LLMProvider.js';
import type { LLMCompletionRequest, LLMCompletionResponse } from '../../src/types.js';

class MockProvider extends LLMProvider {
  readonly name = 'mock';

  async complete(_request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
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
});

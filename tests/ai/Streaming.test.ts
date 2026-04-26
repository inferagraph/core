import { describe, it, expect } from 'vitest';
import { LLMProvider } from '../../src/ai/LLMProvider.js';
import { AIEngine } from '../../src/ai/AIEngine.js';
import { GraphStore } from '../../src/store/GraphStore.js';
import { QueryEngine } from '../../src/store/QueryEngine.js';
import type { LLMCompletionRequest, LLMCompletionResponse, LLMStreamChunk } from '../../src/types.js';

class MockStreamProvider extends LLMProvider {
  readonly name = 'mock-stream';
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    return { content: 'complete response', usage: { inputTokens: 10, outputTokens: 5 } };
  }
  isConfigured(): boolean { return true; }
  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamChunk> {
    yield { type: 'text', content: 'Hello' };
    yield { type: 'text', content: ' world' };
    yield { type: 'done', content: '' };
  }
}

class MockFallbackProvider extends LLMProvider {
  readonly name = 'mock-fallback';
  async complete(): Promise<LLMCompletionResponse> {
    return { content: 'fallback response' };
  }
  isConfigured(): boolean { return true; }
  // Does NOT override stream() — uses default fallback
}

class MockErrorStreamProvider extends LLMProvider {
  readonly name = 'mock-error';
  async complete(): Promise<LLMCompletionResponse> {
    return { content: '' };
  }
  isConfigured(): boolean { return true; }
  async *stream(): AsyncIterable<LLMStreamChunk> {
    yield { type: 'text', content: 'partial' };
    yield { type: 'error', content: 'connection lost' };
  }
}

async function collectChunks(stream: AsyncIterable<LLMStreamChunk>): Promise<LLMStreamChunk[]> {
  const chunks: LLMStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('Streaming AI Responses', () => {
  describe('LLMProvider.stream()', () => {
    it('should yield text chunks from custom stream implementation', async () => {
      const provider = new MockStreamProvider();
      const chunks = await collectChunks(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'text', content: 'Hello' });
      expect(chunks[1]).toEqual({ type: 'text', content: ' world' });
      expect(chunks[2]).toEqual({ type: 'done', content: '' });
    });

    it('should yield done chunk at the end', async () => {
      const provider = new MockStreamProvider();
      const chunks = await collectChunks(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.type).toBe('done');
    });

    it('should fallback to complete() when stream() is not overridden', async () => {
      const provider = new MockFallbackProvider();
      const chunks = await collectChunks(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: 'text', content: 'fallback response' });
      expect(chunks[1]).toEqual({ type: 'done', content: '' });
    });

    it('should handle error mid-stream', async () => {
      const provider = new MockErrorStreamProvider();
      const chunks = await collectChunks(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: 'text', content: 'partial' });
      expect(chunks[1]).toEqual({ type: 'error', content: 'connection lost' });
    });

    it('should collect all text chunks into complete response', async () => {
      const provider = new MockStreamProvider();
      const chunks = await collectChunks(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }));
      const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
      expect(text).toBe('Hello world');
    });
  });

  describe('AIEngine.queryStream()', () => {
    it('should yield chunks from provider stream', async () => {
      const store = new GraphStore();
      const queryEngine = new QueryEngine(store);
      const engine = new AIEngine(store, queryEngine);
      engine.setProvider(new MockStreamProvider());

      const chunks = await collectChunks(engine.queryStream('test question'));
      expect(chunks.length).toBeGreaterThan(0);
      const textChunks = chunks.filter(c => c.type === 'text');
      expect(textChunks.length).toBeGreaterThan(0);
    });

    it('should throw if no provider is set', async () => {
      const store = new GraphStore();
      const queryEngine = new QueryEngine(store);
      const engine = new AIEngine(store, queryEngine);

      await expect(async () => {
        for await (const _chunk of engine.queryStream('test')) {
          // should throw before yielding
        }
      }).rejects.toThrow('No LLM provider configured');
    });

    it('should use default fallback when provider has no custom stream', async () => {
      const store = new GraphStore();
      const queryEngine = new QueryEngine(store);
      const engine = new AIEngine(store, queryEngine);
      engine.setProvider(new MockFallbackProvider());

      const chunks = await collectChunks(engine.queryStream('test question'));
      expect(chunks.some(c => c.type === 'text' && c.content === 'fallback response')).toBe(true);
    });
  });
});

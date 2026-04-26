import type { LLMCompletionRequest, LLMCompletionResponse, LLMStreamChunk } from '../types.js';

export abstract class LLMProvider {
  abstract readonly name: string;

  abstract complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;

  abstract isConfigured(): boolean;

  /** Stream response chunks. Default implementation calls complete() and yields a single chunk. */
  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamChunk> {
    const response = await this.complete(request);
    yield { type: 'text', content: response.content };
    yield { type: 'done', content: '' };
  }
}

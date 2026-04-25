import type { LLMCompletionRequest, LLMCompletionResponse } from '../types.js';

export abstract class LLMProvider {
  abstract readonly name: string;

  abstract complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;

  abstract isConfigured(): boolean;
}

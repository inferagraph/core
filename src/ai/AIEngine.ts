import type { AIQueryResult } from '../types.js';
import type { GraphStore } from '../store/GraphStore.js';
import type { QueryEngine } from '../store/QueryEngine.js';
import { LLMProvider } from './LLMProvider.js';
import { ContextBuilder } from './ContextBuilder.js';
import { IntentParser } from './IntentParser.js';
import { ResponseHandler } from './ResponseHandler.js';

export class AIEngine {
  private provider: LLMProvider | null = null;
  private readonly contextBuilder: ContextBuilder;
  private readonly responseHandler: ResponseHandler;

  constructor(
    private readonly store: GraphStore,
    private readonly queryEngine: QueryEngine,
  ) {
    this.contextBuilder = new ContextBuilder(store, queryEngine);
    const intentParser = new IntentParser(store);
    this.responseHandler = new ResponseHandler(intentParser);
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  getProvider(): LLMProvider | null {
    return this.provider;
  }

  async query(question: string): Promise<AIQueryResult> {
    if (!this.provider) {
      throw new Error('No LLM provider configured. Call setProvider() first.');
    }

    const context = this.contextBuilder.buildContextForQuery(question);
    const response = await this.provider.complete({
      messages: [
        {
          role: 'system',
          content: `You are a knowledgeable Bible scholar assistant. Answer questions using the following graph data as context:\n\n${context}`,
        },
        { role: 'user', content: question },
      ],
      maxTokens: 1024,
    });

    return this.responseHandler.processResponse(response.content, context);
  }
}
